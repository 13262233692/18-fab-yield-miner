import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { TasksService } from '../tasks/tasks.service';
import { ScratchDetectionService, BatchScratchResult } from '../scratch/scratch-detection.service';
import { SseEventBus, ScratchAlertEvent, TaskProgressEvent } from '../events/sse-event-bus';
import { BULLMQ_QUEUE } from '../queue/queue.module';

const SCRATCH_JOB_PREFIX = 'scratch-detection';

@Injectable()
@Processor(BULLMQ_QUEUE, {
  concurrency: 1,
  lockDuration: 600000,
  stalledInterval: 120000,
})
export class ScratchDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(ScratchDetectionProcessor.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly scratchService: ScratchDetectionService,
    private readonly eventBus: SseEventBus,
  ) {
    super();
  }

  async process(job: Job<any>): Promise<any> {
    const { taskId, batchId, batchName, options } = job.data;

    if (job.data.__jobType !== SCRATCH_JOB_PREFIX) {
      return;
    }

    this.logger.log(`[Scratch] Starting task ${taskId} for batch ${batchName}`);

    try {
      await this.tasksService.updateTaskMeta(taskId, { status: 'running', startedAt: Date.now() });

      this.emitProgress({
        taskId,
        batchId,
        phase: '准备阶段',
        percent: 2,
        message: '初始化 Radon 变换算子...',
      });

      const result: BatchScratchResult = await this.scratchService.analyzeBatch(
        batchId,
        {
          ...options,
          onProgress: (idx, total, waferId) => {
            const basePercent = 5;
            const progressRange = 90;
            const percent = basePercent + (idx / Math.max(total, 1)) * progressRange;

            this.emitProgress({
              taskId,
              batchId,
              phase: '晶圆扫描',
              percent,
              message: `分析晶圆 ${waferId} (${idx}/${total})`,
              waferIndex: idx,
              totalWafers: total,
              currentWaferId: waferId,
            });
          },
        },
      );

      result.taskId = taskId;

      this.emitProgress({
        taskId,
        batchId,
        phase: '结果聚合',
        percent: 96,
        message: '聚合批次分析结果...',
      });

      result.wafers.forEach((wafer) => {
        const hasCritical = wafer.severityCount.CRITICAL > 0;
        const hasWarning = wafer.severityCount.WARNING > 0;

        if (hasCritical || hasWarning) {
          const alert: ScratchAlertEvent = {
            type: 'scratch_detected',
            taskId,
            batchId,
            waferId: wafer.waferId,
            severity: hasCritical ? 'CRITICAL' : 'WARNING',
            scratchCount: wafer.scratchLines.length,
            criticalCount: wafer.severityCount.CRITICAL,
            warningCount: wafer.severityCount.WARNING,
            timestamp: Date.now(),
          };
          this.eventBus.emit(alert);

          if (hasCritical) {
            this.logger.warn(
              `[Scratch] ⚠️ CRITICAL: Wafer ${wafer.waferId} has ` +
              `${wafer.severityCount.CRITICAL} critical scratches detected!`
            );
          }
        }
      });

      await this.tasksService.saveResult(taskId, result);
      await this.tasksService.setCompleted(taskId);

      this.emitProgress({
        taskId,
        batchId,
        phase: '完成',
        percent: 100,
        message: `检测完成：发现 ${result.summary.wafersWithScratches}/${result.summary.totalWafers} 片有划痕`,
      });

      this.logger.log(`[Scratch] Task ${taskId} completed successfully`);
      return { success: true, taskId, summary: result.summary };

    } catch (error) {
      this.logger.error(`[Scratch] Task ${taskId} failed: ${error.message}`, error.stack);
      await this.tasksService.setFailed(taskId, error.message || 'Scratch detection failed');
      throw error;
    }
  }

  private emitProgress(event: Omit<TaskProgressEvent, 'type'>) {
    const fullEvent: TaskProgressEvent = {
      type: 'progress',
      ...event,
    };
    this.eventBus.emit(fullEvent as any);

    this.tasksService.updateProgress(
      event.taskId,
      event.phase,
      event.percent,
      event.message,
    ).catch((err) => {
      this.logger.debug(`Failed to update task progress: ${err.message}`);
    });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    if (job.data?.__jobType === SCRATCH_JOB_PREFIX) {
      this.logger.log(`Job ${job.id} (scratch detection) completed`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    if (job.data?.__jobType === SCRATCH_JOB_PREFIX) {
      this.logger.error(`Job ${job.id} (scratch detection) failed: ${err.message}`);
    }
  }
}

export { SCRATCH_JOB_PREFIX };
