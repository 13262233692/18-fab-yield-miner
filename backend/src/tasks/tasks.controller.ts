import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Delete,
  NotFoundException,
  BadRequestException,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { TasksService, TaskMeta, AnalysisResult } from './tasks.service';
import { BatchesService } from '../batches/batches.service';
import { Observable, interval, map, switchMap, takeWhile } from 'rxjs';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly batchesService: BatchesService,
  ) {}

  @Post('overlap-analysis/:batchId')
  async submitOverlapAnalysis(@Param('batchId') batchId: string): Promise<TaskMeta> {
    const batch = await this.batchesService.findOne(batchId);
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} not found`);
    }

    if (batch.defectCount === 0) {
      throw new BadRequestException('Batch has no defect data');
    }

    return this.tasksService.submitTask(
      batchId,
      batch.batchName,
      batch.waferCount,
    );
  }

  @Get(':taskId')
  async getTaskStatus(@Param('taskId') taskId: string): Promise<TaskMeta> {
    return this.tasksService.getTaskOrThrow(taskId);
  }

  @Get(':taskId/result')
  async getTaskResult(@Param('taskId') taskId: string): Promise<AnalysisResult> {
    const meta = await this.tasksService.getTaskOrThrow(taskId);
    if (meta.status !== 'completed') {
      throw new BadRequestException(
        `Task not completed yet. Current status: ${meta.status}`,
      );
    }

    const result = await this.tasksService.getResult(taskId);
    if (!result) {
      throw new NotFoundException('Result not found');
    }
    return result;
  }

  @Get()
  async listTasks(@Body('batchId') batchId?: string): Promise<TaskMeta[]> {
    return this.tasksService.listTasks(batchId);
  }

  @Delete(':taskId')
  async cancelTask(@Param('taskId') taskId: string): Promise<{ success: boolean }> {
    await this.tasksService.cancelTask(taskId);
    return { success: true };
  }

  @Sse(':taskId/stream')
  streamTaskStatus(@Param('taskId') taskId: string): Observable<MessageEvent> {
    return interval(1000).pipe(
      switchMap(async () => {
        const meta = await this.tasksService.getTaskMeta(taskId);
        const result = meta?.status === 'completed'
          ? await this.tasksService.getResult(taskId)
          : null;
        return { meta, result };
      }),
      takeWhile(({ meta }) => {
        if (!meta) return false;
        return meta.status !== 'completed' && meta.status !== 'failed';
      }, true),
      map(({ meta, result }) => ({
        id: taskId,
        data: JSON.stringify({ meta, result }),
      })),
    );
  }
}
