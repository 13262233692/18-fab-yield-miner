import { Injectable, Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { BULLMQ_QUEUE, REDIS_CLIENT } from '../queue/queue.module';
import { detectScratchLines, ScratchLine, DefectPoint } from '../analysis/radon';
import { TasksService } from '../tasks/tasks.service';

export const SCRATCH_QUEUE = 'scratch-detect-queue';
export const SCRATCH_RESULT_PREFIX = 'scratch:result:';
export const SCRATCH_PROGRESS_PREFIX = 'scratch:progress:';

export interface ScratchDetectionResult {
  taskId: string;
  batchId: string;
  scannedWafers: number;
  totalDefects: number;
  scratchLines: ScratchLine[];
  severity: 'normal' | 'warning' | 'critical';
  summary: {
    criticalScratches: number;
    warningScratches: number;
    affectedWafers: string[];
  };
  completedAt: number;
}

@Injectable()
@Processor(SCRATCH_QUEUE, {
  concurrency: 2,
  lockDuration: 120000,
  stalledInterval: 60000,
})
export class ScratchDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(ScratchDetectionProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tasksService: TasksService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { taskId, batchId, batchName, waferId } = job.data;
    this.logger.log(`[Scratch ${taskId}] Starting scratch detection for batch ${batchName}`);

    try {
      await this.redis.setex(
        SCRATCH_PROGRESS_PREFIX + taskId,
        3600,
        JSON.stringify({
          taskId,
          status: 'running',
          phase: '初始化',
          percent: 0,
          message: '任务已启动',
        }),
      );

      const queryRunner = this.dataSource.createQueryRunner();
      let wafersToScan: string[] = [];

      try {
        await this.updateProgress(taskId, '数据加载', 5, '查询晶圆列表...');

        if (waferId) {
          wafersToScan = [waferId];
        } else {
          const waferRows: { wafer_id: string }[] = await queryRunner.query(
            `SELECT DISTINCT wafer_id FROM defects WHERE batch_id = $1 ORDER BY wafer_id`,
            [batchId],
          );
          wafersToScan = waferRows.map(r => r.wafer_id);
        }

        this.logger.log(`[Scratch ${taskId}] Found ${wafersToScan.length} wafers to scan`);

        const allScratchLines: ScratchLine[] = [];
        let totalDefects = 0;

        for (let wi = 0; wi < wafersToScan.length; wi++) {
          const wid = wafersToScan[wi];
          const progress = 10 + (wi / wafersToScan.length) * 70;
          await this.updateProgress(
            taskId,
            'Radon 变换检测',
            progress,
            `分析晶圆 ${wid} (${wi + 1}/${wafersToScan.length})...`,
          );

          const defects = await queryRunner.query(
            `SELECT defect_x as x, defect_y as y, defect_size as size
             FROM defects WHERE batch_id = $1 AND wafer_id = $2`,
            [batchId, wid],
          );

          totalDefects += defects.length;

          if (defects.length < 20) continue;

          const points: DefectPoint[] = defects.map(d => ({
            x: parseFloat(d.x),
            y: parseFloat(d.y),
            size: parseFloat(d.size) || 1,
          }));

          const lines = detectScratchLines(points, wid, 20, 0.55, 8);

          if (lines.length > 0) {
            this.logger.log(
              `[Scratch ${taskId}] Wafer ${wid}: detected ${lines.length} scratch lines ` +
              `(confidence ${lines.map(l => l.confidence.toFixed(2)).join(', ')})`,
            );
            allScratchLines.push(...lines);
          }
        }

        await this.updateProgress(taskId, '结果汇总', 85, '计算全局严重等级...');

        const criticalScratches = allScratchLines.filter(l => l.confidence >= 0.8 || l.lengthMm >= 40).length;
        const warningScratches = allScratchLines.filter(l => l.confidence >= 0.6 && l.confidence < 0.8).length;
        const affectedWafers = Array.from(new Set(allScratchLines.map(l => l.waferId)));

        let severity: 'normal' | 'warning' | 'critical' = 'normal';
        if (criticalScratches >= 2 || affectedWafers.length >= 3) {
          severity = 'critical';
        } else if (criticalScratches >= 1 || warningScratches >= 2 || affectedWafers.length >= 1) {
          severity = 'warning';
        }

        const result: ScratchDetectionResult = {
          taskId,
          batchId,
          scannedWafers: wafersToScan.length,
          totalDefects,
          scratchLines: allScratchLines,
          severity,
          summary: {
            criticalScratches,
            warningScratches,
            affectedWafers,
          },
          completedAt: Date.now(),
        };

        await this.redis.setex(
          SCRATCH_RESULT_PREFIX + taskId,
          3600 * 24,
          JSON.stringify(result),
        );

        await this.redis.setex(
          SCRATCH_PROGRESS_PREFIX + taskId,
          3600,
          JSON.stringify({
            taskId,
            status: 'completed',
            phase: '完成',
            percent: 100,
            message: `检测完成: ${severity.toUpperCase()}`,
            severity,
          }),
        );

        this.logger.log(
          `[Scratch ${taskId}] Detection complete: severity=${severity}, ` +
          `${allScratchLines.length} lines, ${affectedWafers.length} wafers affected`,
        );

        return result;

      } finally {
        await queryRunner.release();
      }

    } catch (error) {
      this.logger.error(`[Scratch ${taskId}] Failed: ${error.message}`, error.stack);
      await this.redis.setex(
        SCRATCH_PROGRESS_PREFIX + taskId,
        3600,
        JSON.stringify({
          taskId,
          status: 'failed',
          phase: '失败',
          percent: 100,
          message: error.message || '检测失败',
        }),
      );
      throw error;
    }
  }

  private async updateProgress(taskId: string, phase: string, percent: number, message: string) {
    await this.redis.setex(
      SCRATCH_PROGRESS_PREFIX + taskId,
      3600,
      JSON.stringify({
        taskId,
        status: 'running',
        phase,
        percent,
        message,
      }),
    );
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.debug(`Scratch detection job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Scratch detection job ${job.id} failed: ${err.message}`);
  }
}
