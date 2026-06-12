import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Inject,
  NotFoundException,
  BadRequestException,
  Sse,
  MessageEvent,
  Res,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Response } from 'express';
import Redis from 'ioredis';
import { Observable, interval, map, switchMap, takeWhile, filter } from 'rxjs';
import { BatchesService } from '../batches/batches.service';
import {
  SCRATCH_QUEUE,
  SCRATCH_RESULT_PREFIX,
  SCRATCH_PROGRESS_PREFIX,
  ScratchDetectionResult,
} from './scratch-detection.processor';
import { REDIS_CLIENT } from '../queue/queue.module';

@Controller('scratch')
export class ScratchController {
  constructor(
    @InjectQueue(SCRATCH_QUEUE) private readonly scratchQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly batchesService: BatchesService,
  ) {}

  @Post('detect/:batchId')
  async startDetection(
    @Param('batchId') batchId: string,
    @Query('waferId') waferId?: string,
  ): Promise<{ taskId: string; status: string }> {
    const batch = await this.batchesService.findOne(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    const taskId = `scratch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await this.scratchQueue.add(SCRATCH_QUEUE, {
      taskId,
      batchId,
      batchName: batch.batchName,
      waferId,
    }, {
      jobId: taskId,
      priority: 5,
    });

    return { taskId, status: 'queued' };
  }

  @Get('progress/:taskId')
  async getProgress(@Param('taskId') taskId: string): Promise<any> {
    const raw = await this.redis.get(SCRATCH_PROGRESS_PREFIX + taskId);
    if (!raw) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }
    return JSON.parse(raw);
  }

  @Get('result/:taskId')
  async getResult(@Param('taskId') taskId: string): Promise<ScratchDetectionResult> {
    const progressRaw = await this.redis.get(SCRATCH_PROGRESS_PREFIX + taskId);
    if (!progressRaw) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }
    const progress = JSON.parse(progressRaw);
    if (progress.status !== 'completed') {
      throw new BadRequestException(
        `Task not completed, current status: ${progress.status}`,
      );
    }

    const raw = await this.redis.get(SCRATCH_RESULT_PREFIX + taskId);
    if (!raw) {
      throw new NotFoundException(`Result for task ${taskId} not found`);
    }
    return JSON.parse(raw);
  }

  @Sse('stream/:taskId')
  streamProgress(@Param('taskId') taskId: string): Observable<MessageEvent> {
    return interval(800).pipe(
      switchMap(async () => {
        const progressRaw = await this.redis.get(SCRATCH_PROGRESS_PREFIX + taskId);
        const resultRaw = await this.redis.get(SCRATCH_RESULT_PREFIX + taskId);
        return {
          progress: progressRaw ? JSON.parse(progressRaw) : null,
          result: resultRaw ? JSON.parse(resultRaw) : null,
        };
      }),
      takeWhile(({ progress }) => {
        if (!progress) return true;
        return progress.status !== 'completed' && progress.status !== 'failed';
      }, true),
      map(({ progress, result }) => ({
        id: taskId,
        type: result ? 'result' : 'progress',
        data: JSON.stringify({ progress, result }),
      })),
    );
  }
}
