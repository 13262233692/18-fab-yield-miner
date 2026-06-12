import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TasksService } from '../tasks/tasks.service';
import { BULLMQ_QUEUE } from '../queue/queue.module';

interface WaferSnapshot {
  waferId: string;
  defects: Array<{
    id: string;
    x: number;
    y: number;
    size: number;
    defectClass: string;
  }>;
}

interface HotspotCell {
  x: number;
  y: number;
  count: number;
  wafers: Set<string>;
}

@Injectable()
@Processor(BULLMQ_QUEUE, {
  concurrency: 2,
  lockDuration: 300000,
  stalledInterval: 60000,
})
export class OverlapAnalysisProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(OverlapAnalysisProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly tasksService: TasksService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log(`OverlapAnalysisProcessor initialized, concurrency=2`);
  }

  async process(job: Job<any>): Promise<any> {
    const { taskId, batchId, batchName, waferCount } = job.data;
    this.logger.log(`[Task ${taskId}] Starting overlap analysis for batch ${batchName}`);

    try {
      await this.tasksService.updateTaskMeta(taskId, { status: 'running', startedAt: Date.now() });

      const snapshots = await this.loadWaferSnapshots(batchId, taskId);

      if (snapshots.length === 0) {
        throw new Error('No defect data found for this batch');
      }

      await this.tasksService.updateProgress(taskId, '空间重叠计算', 30,
        `已加载 ${snapshots.length} 片晶圆快照，开始 O(N²) 重叠分析...`);

      const result = await this.computeOverlapAnalysis(snapshots, batchId, taskId);

      await this.tasksService.saveResult(taskId, result);
      await this.tasksService.setCompleted(taskId);

      this.logger.log(`[Task ${taskId}] Analysis completed successfully`);
      return { success: true, taskId };

    } catch (error) {
      this.logger.error(`[Task ${taskId}] Analysis failed: ${error.message}`, error.stack);
      await this.tasksService.setFailed(taskId, error.message || 'Unknown error');
      throw error;
    }
  }

  private async loadWaferSnapshots(batchId: string, taskId: string): Promise<WaferSnapshot[]> {
    await this.tasksService.updateProgress(taskId, '数据加载', 5,
      '从数据库读取缺陷坐标到内存快照...');

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      const waferIds: string[] = await queryRunner.query(
        `SELECT DISTINCT wafer_id FROM defects WHERE batch_id = $1 ORDER BY wafer_id`,
        [batchId]
      ).then(rows => rows.map(r => r.wafer_id));

      this.logger.log(`[Task ${taskId}] Found ${waferIds.length} wafers`);

      const totalCountRow: { total: string }[] = await queryRunner.query(
        `SELECT COUNT(*) as total FROM defects WHERE batch_id = $1`,
        [batchId]
      );
      const totalDefects = parseInt(totalCountRow[0].total);
      this.logger.log(`[Task ${taskId}] Total defects: ${totalDefects}`);

      const snapshots: WaferSnapshot[] = [];

      for (let i = 0; i < waferIds.length; i++) {
        const waferId = waferIds[i];
        await this.tasksService.updateProgress(taskId, '数据加载', 5 + (i / waferIds.length) * 20,
          `加载晶圆 ${waferId} (${i + 1}/${waferIds.length})...`);

        const defects = await queryRunner.query(
          `SELECT id, defect_x as x, defect_y as y, defect_size as size, defect_class as "defectClass"
           FROM defects WHERE batch_id = $1 AND wafer_id = $2`,
          [batchId, waferId]
        );

        snapshots.push({
          waferId,
          defects: defects.map(d => ({
            id: d.id,
            x: parseFloat(d.x),
            y: parseFloat(d.y),
            size: parseFloat(d.size) || 0,
            defectClass: d.defectClass || '',
          })),
        });
      }

      this.logger.log(`[Task ${taskId}] All snapshots loaded into memory, releasing DB connection`);
      return snapshots;

    } finally {
      await queryRunner.release();
    }
  }

  private async computeOverlapAnalysis(
    snapshots: WaferSnapshot[],
    batchId: string,
    taskId: string,
  ): Promise<any> {
    const OVERLAP_RADIUS_MM = 1.5;
    const GRID_SIZE_MM = 5;

    const waferDefectCounts: Record<string, number> = {};
    snapshots.forEach(s => {
      waferDefectCounts[s.waferId] = s.defects.length;
    });

    const totalDefects = Object.values(waferDefectCounts).reduce((a, b) => a + b, 0);
    const waferIds = snapshots.map(s => s.waferId);

    const waferGrids: Record<string, Map<string, number[]>> = {};

    snapshots.forEach((s, idx) => {
      const grid = new Map<string, number[]>();
      s.defects.forEach((defect, defectIdx) => {
        const gx = Math.floor(defect.x / GRID_SIZE_MM);
        const gy = Math.floor(defect.y / GRID_SIZE_MM);
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(defectIdx);
      });
      waferGrids[s.waferId] = grid;

      if (idx % 5 === 0) {
        this.logger.debug(`[Task ${taskId}] Built spatial grid for ${s.waferId}`);
      }
    });

    const overlapPairs: Array<{
      waferA: string;
      waferB: string;
      overlapCount: number;
      overlapRatio: number;
    }> = [];

    const waferMatrix: Record<string, Record<string, number>> = {};
    waferIds.forEach(id => { waferMatrix[id] = {}; });

    const globalHotspots = new Map<string, HotspotCell>();
    const waferOverlapSum: Record<string, number> = {};
    const waferOverlapMax: Record<string, number> = {};
    waferIds.forEach(id => { waferOverlapSum[id] = 0; waferOverlapMax[id] = 0; });

    const totalPairs = (waferIds.length * (waferIds.length - 1)) / 2;
    let processedPairs = 0;

    for (let i = 0; i < waferIds.length; i++) {
      for (let j = i + 1; j < waferIds.length; j++) {
        const waferA = waferIds[i];
        const waferB = waferIds[j];
        const gridA = waferGrids[waferA];
        const gridB = waferGrids[waferB];
        const defectsA = snapshots[i].defects;
        const defectsB = snapshots[j].defects;

        let overlapCount = 0;
        const hotspotCounts = new Map<string, { count: number; sumX: number; sumY: number }>();

        gridA.forEach((indicesA, cellKey) => {
          const [gx, gy] = cellKey.split(',').map(Number);

          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              const neighborKey = `${gx + dx},${gy + dy}`;
              const indicesB = gridB.get(neighborKey);
              if (!indicesB) continue;

              for (const idxA of indicesA) {
                const dA = defectsA[idxA];
                for (const idxB of indicesB) {
                  const dB = defectsB[idxB];
                  const distX = dA.x - dB.x;
                  const distY = dA.y - dB.y;
                  const distSq = distX * distX + distY * distY;

                  if (distSq <= OVERLAP_RADIUS_MM * OVERLAP_RADIUS_MM) {
                    overlapCount++;

                    const hx = Math.floor((dA.x + dB.x) / 2 / GRID_SIZE_MM);
                    const hy = Math.floor((dA.y + dB.y) / 2 / GRID_SIZE_MM);
                    const hkey = `${hx},${hy}`;
                    if (!hotspotCounts.has(hkey)) {
                      hotspotCounts.set(hkey, { count: 0, sumX: 0, sumY: 0 });
                    }
                    const h = hotspotCounts.get(hkey)!;
                    h.count++;
                    h.sumX += (dA.x + dB.x) / 2;
                    h.sumY += (dA.y + dB.y) / 2;

                    if (!globalHotspots.has(hkey)) {
                      globalHotspots.set(hkey, {
                        x: 0, y: 0, count: 0, wafers: new Set(),
                      });
                    }
                    const gh = globalHotspots.get(hkey)!;
                    gh.count++;
                    gh.wafers.add(waferA);
                    gh.wafers.add(waferB);
                  }
                }
              }
            }
          }
        });

        const countA = waferDefectCounts[waferA];
        const countB = waferDefectCounts[waferB];
        const overlapRatio = overlapCount / Math.sqrt(countA * countB + 1);

        waferMatrix[waferA][waferB] = overlapCount;
        waferMatrix[waferB][waferA] = overlapCount;

        overlapPairs.push({ waferA, waferB, overlapCount, overlapRatio });

        waferOverlapSum[waferA] += overlapRatio;
        waferOverlapSum[waferB] += overlapRatio;
        waferOverlapMax[waferA] = Math.max(waferOverlapMax[waferA], overlapRatio);
        waferOverlapMax[waferB] = Math.max(waferOverlapMax[waferB], overlapRatio);

        processedPairs++;
        if (processedPairs % 5 === 0 || processedPairs === totalPairs) {
          const percent = 30 + (processedPairs / Math.max(totalPairs, 1)) * 60;
          await this.tasksService.updateProgress(taskId, '空间重叠计算', percent,
            `重叠分析: ${processedPairs}/${totalPairs} 晶圆对`);
        }

        if (processedPairs % 50 === 0) {
          this.logger.debug(`[Task ${taskId}] Progress: ${processedPairs}/${totalPairs} pairs`);
        }
      }
    }

    overlapPairs.sort((a, b) => b.overlapRatio - a.overlapRatio);

    const perWaferStats: Record<string, any> = {};
    waferIds.forEach(id => {
      const otherCount = waferIds.length - 1;
      perWaferStats[id] = {
        defectCount: waferDefectCounts[id],
        avgOverlapRatio: otherCount > 0 ? waferOverlapSum[id] / otherCount : 0,
        maxOverlapRatio: waferOverlapMax[id],
      };
    });

    await this.tasksService.updateProgress(taskId, '热点聚合', 92,
      '聚合全局重叠热点区域...');

    const sortedHotspots = Array.from(globalHotspots.values())
      .filter(h => h.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map(h => ({
        centroidX: h.x,
        centroidY: h.y,
        defectCount: h.count,
        involvedWafers: Array.from(h.wafers),
      }));

    const hotspotCentroids = Array.from(globalHotspots.entries())
      .filter(([, h]) => h.count >= 3)
      .map(([key, h]) => {
        const [gx, gy] = key.split(',').map(Number);
        return {
          centroidX: (gx + 0.5) * GRID_SIZE_MM,
          centroidY: (gy + 0.5) * GRID_SIZE_MM,
          defectCount: h.count,
          involvedWafers: Array.from(h.wafers),
        };
      })
      .sort((a, b) => b.defectCount - a.defectCount)
      .slice(0, 50);

    let avgOverlapRatio = 0;
    if (overlapPairs.length > 0) {
      avgOverlapRatio = overlapPairs.reduce((s, p) => s + p.overlapRatio, 0) / overlapPairs.length;
    }

    const topPair = overlapPairs[0] || { waferA: '-', waferB: '-', overlapRatio: 0 };

    await this.tasksService.updateProgress(taskId, '结果序列化', 98,
      '序列化分析结果...');

    return {
      taskId,
      batchId,
      summary: {
        totalDefects,
        waferCount: waferIds.length,
        avgOverlapRatio,
        highestOverlapPair: [topPair.waferA, topPair.waferB],
        highestOverlapRatio: topPair.overlapRatio,
      },
      waferMatrix,
      overlapPairs: overlapPairs.slice(0, 200),
      perWaferStats,
      globalHotspots: hotspotCentroids,
    };
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} started processing`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`Job ${job.id} failed: ${err.message}`);
  }
}
