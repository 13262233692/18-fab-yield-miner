import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  NotFoundException,
  BadRequestException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable, interval, map, switchMap, takeWhile, merge } from 'rxjs';
import { ScratchDetectionService, WaferScratchResult, BatchScratchResult } from './scratch-detection.service';
import { TasksService } from '../tasks/tasks.service';
import { BatchesService } from '../batches/batches.service';
import { SseEventBus } from '../events/sse-event-bus';
import { SCRATCH_JOB_PREFIX } from '../processors/scratch-detection.processor';
import { Queue } from 'bullmq';
import { Inject } from '@nestjs/common';
import { ANALYSIS_QUEUE } from '../queue/queue.module';

@Controller('scratch')
export class ScratchController {
  constructor(
    private readonly scratchService: ScratchDetectionService,
    private readonly tasksService: TasksService,
    private readonly batchesService: BatchesService,
    private readonly eventBus: SseEventBus,
    @Inject(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
  ) {}

  @Post('detect/batch/:batchId')
  async submitBatchDetection(
    @Param('batchId') batchId: string,
    @Body() options: { gridSize?: number; thetaStep?: number } = {},
  ) {
    const batch = await this.batchesService.findOne(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    const existingTasks = await this.tasksService.listTasks(batchId);
    const scratchRunning = existingTasks.find((t) =>
      (t.status === 'queued' || t.status === 'running') &&
      t.taskId.startsWith('scratch_')
    );

    if (scratchRunning) {
      return scratchRunning;
    }

    const taskId = `scratch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const meta = await this.tasksService.submitTask(
      batchId,
      batch.batchName,
      batch.waferCount,
    );
    meta.taskId = taskId;
    meta.status = 'queued';
    meta.progress = { phase: '排队', percent: 0, message: '等待调度执行划痕检测...' };

    await this.tasksService.updateTaskMeta(meta.taskId, {
      taskId: meta.taskId,
      status: 'queued',
      progress: meta.progress,
    });

    await this.analysisQueue.add(
      'scratch-detection-queue',
      {
        __jobType: SCRATCH_JOB_PREFIX,
        taskId: meta.taskId,
        batchId,
        batchName: batch.batchName,
        options,
      },
      {
        jobId: meta.taskId,
        priority: batch.waferCount > 15 ? 5 : 15,
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    );

    return meta;
  }

  @Post('detect/wafer/:batchId/:waferId')
  async detectWafer(
    @Param('batchId') batchId: string,
    @Param('waferId') waferId: string,
    @Body() options: { quick?: boolean; gridSize?: number; thetaStep?: number } = {},
  ): Promise<WaferScratchResult> {
    const batch = await this.batchesService.findOne(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    if (options.quick) {
      return this.scratchService.analyzeWaferQuick(batchId, waferId);
    }

    return this.scratchService.analyzeWafer(batchId, waferId, {
      gridSize: options.gridSize,
      thetaStep: options.thetaStep,
    });
  }

  @Get('result/:taskId')
  async getTaskResult(@Param('taskId') taskId: string): Promise<BatchScratchResult> {
    const meta = await this.tasksService.getTaskOrThrow(taskId);

    if (meta.status === 'failed') {
      throw new BadRequestException(`Task failed: ${meta.error || 'Unknown error'}`);
    }

    if (meta.status !== 'completed') {
      throw new BadRequestException(
        `Task not completed. Current status: ${meta.status}, progress: ${meta.progress?.percent}%`
      );
    }

    const result = await this.tasksService.getResult<BatchScratchResult>(taskId);
    if (!result) {
      throw new NotFoundException('Result not found (may have expired)');
    }

    return result;
  }

  @Get('task/:taskId/status')
  async getTaskStatus(@Param('taskId') taskId: string) {
    return this.tasksService.getTaskOrThrow(taskId);
  }

  @Get('wafer/:batchId/:waferId/result')
  async getCachedWaferResult(
    @Param('batchId') batchId: string,
    @Param('waferId') waferId: string,
  ): Promise<WaferScratchResult | null> {
    const tasks = await this.tasksService.listTasks(batchId);
    const completed = tasks.find((t) => t.status === 'completed' && t.taskId.startsWith('scratch_'));

    if (!completed) {
      return null;
    }

    const batchResult = await this.tasksService.getResult<BatchScratchResult>(completed.taskId);
    if (!batchResult) return null;

    return batchResult.wafers.find((w) => w.waferId === waferId) || null;
  }

  @Sse('stream/:taskId')
  streamScratchEvents(
    @Param('taskId') taskId: string,
  ): Observable<MessageEvent> {
    const sseSubscription = this.eventBus.subscribe(taskId);

    const statusPolling = interval(2000).pipe(
      switchMap(async () => {
        const meta = await this.tasksService.getTaskMeta(taskId);
        if (!meta) return null;

        const result = meta.status === 'completed'
          ? await this.tasksService.getResult(taskId)
          : null;

        return { meta, result };
      }),
      takeWhile((data) => {
        if (!data?.meta) return false;
        return data.meta.status !== 'completed' && data.meta.status !== 'failed';
      }, true),
      map((data) => ({
        id: taskId,
        type: 'status',
        data: JSON.stringify(data),
      })),
    );

    return merge(sseSubscription, statusPolling) as Observable<MessageEvent>;
  }

  @Get('tasks')
  async listTasks(@Query('batchId') batchId?: string) {
    const all = await this.tasksService.listTasks(batchId);
    return all.filter((t) => t.taskId.startsWith('scratch_'));
  }

  @Get('summary/:batchId')
  async getBatchSummary(@Param('batchId') batchId: string) {
    const tasks = await this.tasksService.listTasks(batchId);
    const latestScratch = tasks
      .filter((t) => t.taskId.startsWith('scratch_'))
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    if (!latestScratch) {
      return { hasAnalysis: false };
    }

    let result: BatchScratchResult | null = null;
    if (latestScratch.status === 'completed') {
      result = await this.tasksService.getResult<BatchScratchResult>(latestScratch.taskId);
    }

    return {
      hasAnalysis: true,
      taskId: latestScratch.taskId,
      status: latestScratch.status,
      progress: latestScratch.progress,
      result,
    };
  }
}
