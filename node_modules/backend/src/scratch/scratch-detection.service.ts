import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { runFullRadonAnalysis, ScratchLine } from '../algorithms/radon.transform';

export interface WaferScratchResult {
  waferId: string;
  batchId: string;
  scratchLines: ScratchLine[];
  severityCount: {
    CRITICAL: number;
    WARNING: number;
    MILD: number;
  };
  analysisDurationMs: number;
  totalDefects: number;
  gridSize: number;
  thetaStep: number;
}

export interface BatchScratchResult {
  batchId: string;
  wafers: WaferScratchResult[];
  summary: {
    totalWafers: number;
    wafersWithScratches: number;
    totalCritical: number;
    totalWarning: number;
    totalMild: number;
    highestSeverityWafer?: string;
  };
  taskId?: string;
  completedAt?: number;
}

@Injectable()
export class ScratchDetectionService {
  private readonly logger = new Logger(ScratchDetectionService.name);

  constructor(private readonly dataSource: DataSource) {}

  async analyzeWafer(
    batchId: string,
    waferId: string,
    options: { gridSize?: number; thetaStep?: number } = {},
  ): Promise<WaferScratchResult> {
    const startTime = Date.now();
    const { gridSize = 256, thetaStep = 1 } = options;

    this.logger.debug(`[Scratch] Loading defects for wafer ${waferId}...`);

    const defects = await this.loadWaferDefects(batchId, waferId);

    if (defects.length < 100) {
      this.logger.warn(`[Scratch] Wafer ${waferId} has too few defects (${defects.length}), skipping`);
      return {
        waferId,
        batchId,
        scratchLines: [],
        severityCount: { CRITICAL: 0, WARNING: 0, MILD: 0 },
        analysisDurationMs: Date.now() - startTime,
        totalDefects: defects.length,
        gridSize,
        thetaStep,
      };
    }

    const bounds = this.computeBounds(defects);
    this.logger.debug(
      `[Scratch] Running Radon transform on ${defects.length} defects, ` +
      `grid=${gridSize}, thetaStep=${thetaStep}°`
    );

    const { lines } = runFullRadonAnalysis(defects, bounds, { gridSize, thetaStep });

    const severityCount = { CRITICAL: 0, WARNING: 0, MILD: 0 };
    lines.forEach((line) => {
      severityCount[line.severity]++;
    });

    const duration = Date.now() - startTime;
    this.logger.log(
      `[Scratch] Wafer ${waferId} analysis complete in ${duration}ms: ` +
      `${lines.length} scratches found (${severityCount.CRITICAL} critical, ` +
      `${severityCount.WARNING} warning, ${severityCount.MILD} mild)`
    );

    return {
      waferId,
      batchId,
      scratchLines: lines,
      severityCount,
      analysisDurationMs: duration,
      totalDefects: defects.length,
      gridSize,
      thetaStep,
    };
  }

  async analyzeBatch(
    batchId: string,
    options: {
      gridSize?: number;
      thetaStep?: number;
      onProgress?: (waferIndex: number, totalWafers: number, waferId: string) => void;
    } = {},
  ): Promise<BatchScratchResult> {
    const { gridSize, thetaStep, onProgress } = options;

    const waferIds = await this.listWaferIds(batchId);
    const totalWafers = waferIds.length;

    this.logger.log(
      `[Scratch] Starting batch analysis: ${batchId}, ${totalWafers} wafers`
    );

    const waferResults: WaferScratchResult[] = [];
    let highestSeverityCount = 0;
    let highestSeverityWafer: string | undefined;

    for (let i = 0; i < totalWafers; i++) {
      const waferId = waferIds[i];

      try {
        const waferResult = await this.analyzeWafer(batchId, waferId, { gridSize, thetaStep });
        waferResults.push(waferResult);

        const totalSeverity =
          waferResult.severityCount.CRITICAL * 3 +
          waferResult.severityCount.WARNING * 2 +
          waferResult.severityCount.MILD;

        if (totalSeverity > highestSeverityCount) {
          highestSeverityCount = totalSeverity;
          highestSeverityWafer = waferId;
        }
      } catch (error) {
        this.logger.error(`[Scratch] Failed to analyze wafer ${waferId}: ${error.message}`);
        waferResults.push({
          waferId,
          batchId,
          scratchLines: [],
          severityCount: { CRITICAL: 0, WARNING: 0, MILD: 0 },
          analysisDurationMs: 0,
          totalDefects: 0,
          gridSize: gridSize || 256,
          thetaStep: thetaStep || 1,
        });
      }

      if (onProgress) {
        onProgress(i + 1, totalWafers, waferIds[i]);
      }
    }

    const summary = {
      totalWafers,
      wafersWithScratches: waferResults.filter((w) => w.scratchLines.length > 0).length,
      totalCritical: waferResults.reduce((s, w) => s + w.severityCount.CRITICAL, 0),
      totalWarning: waferResults.reduce((s, w) => s + w.severityCount.WARNING, 0),
      totalMild: waferResults.reduce((s, w) => s + w.severityCount.MILD, 0),
      highestSeverityWafer,
    };

    this.logger.log(
      `[Scratch] Batch ${batchId} complete: ` +
      `${summary.wafersWithScratches}/${summary.totalWafers} wafers with scratches, ` +
      `${summary.totalCritical} critical, ${summary.totalWarning} warning`
    );

    return {
      batchId,
      wafers: waferResults,
      summary,
      completedAt: Date.now(),
    };
  }

  async analyzeWaferQuick(
    batchId: string,
    waferId: string,
  ): Promise<WaferScratchResult> {
    return this.analyzeWafer(batchId, waferId, {
      gridSize: 192,
      thetaStep: 1.5,
    });
  }

  async getCachedWaferResult(taskId: string, waferId: string): Promise<WaferScratchResult | null> {
    return null;
  }

  private async loadWaferDefects(
    batchId: string,
    waferId: string,
  ): Promise<Array<{ x: number; y: number; size: number }>> {
    const qr = this.dataSource.createQueryRunner();
    try {
      const rows = await qr.query(
        `SELECT defect_x as x, defect_y as y, defect_size as size
         FROM defects
         WHERE batch_id = $1 AND wafer_id = $2`,
        [batchId, waferId]
      );

      return rows.map((row: any) => ({
        x: parseFloat(row.x),
        y: parseFloat(row.y),
        size: parseFloat(row.size) || 0,
      }));
    } finally {
      await qr.release();
    }
  }

  private async listWaferIds(batchId: string): Promise<string[]> {
    const qr = this.dataSource.createQueryRunner();
    try {
      const rows = await qr.query(
        `SELECT DISTINCT wafer_id FROM defects WHERE batch_id = $1 ORDER BY wafer_id`,
        [batchId]
      );
      return rows.map((r: any) => r.wafer_id);
    } finally {
      await qr.release();
    }
  }

  private computeBounds(defects: Array<{ x: number; y: number }>) {
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;

    for (const d of defects) {
      xMin = Math.min(xMin, d.x);
      xMax = Math.max(xMax, d.x);
      yMin = Math.min(yMin, d.y);
      yMax = Math.max(yMax, d.y);
    }

    const padding = Math.max(xMax - xMin, yMax - yMin) * 0.1;
    xMin -= padding;
    xMax += padding;
    yMin -= padding;
    yMax += padding;

    return { xMin, xMax, yMin, yMax };
  }
}
