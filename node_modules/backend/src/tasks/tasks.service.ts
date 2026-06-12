import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ANALYSIS_QUEUE, REDIS_CLIENT, BULLMQ_QUEUE } from '../queue/queue.module';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface TaskProgress {
  phase: string;
  percent: number;
  message: string;
}

export interface TaskMeta {
  taskId: string;
  batchId: string;
  batchName: string;
  waferCount: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  status: TaskStatus;
  progress?: TaskProgress;
  error?: string;
}

export interface OverlapResult {
  waferA: string;
  waferB: string;
  overlapCount: number;
  overlapArea: number;
  overlapRatioA: number;
  overlapRatioB: number;
  hotspotClusters: Array<{
    centroidX: number;
    centroidY: number;
    defectCount: number;
  }>;
}

export interface AnalysisResult {
  taskId: string;
  batchId: string;
  summary: {
    totalDefects: number;
    waferCount: number;
    avgOverlapRatio: number;
    highestOverlapPair: [string, string];
    highestOverlapRatio: number;
  };
  waferMatrix: Record<string, Record<string, number>>;
  overlapPairs: Array<{
    waferA: string;
    waferB: string;
    overlapCount: number;
    overlapRatio: number;
  }>;
  perWaferStats: Record<string, {
    defectCount: number;
    avgOverlapRatio: number;
    maxOverlapRatio: number;
  }>;
  globalHotspots: Array<{
    centroidX: number;
    centroidY: number;
    defectCount: number;
    involvedWafers: string[];
  }>;
}

const TASK_META_PREFIX = 'task:meta:';
const TASK_RESULT_PREFIX = 'task:result:';
const TASK_TTL = 60 * 60 * 24;
const BATCH_LOCK_PREFIX = 'batch:lock:';

@Injectable()
export class TasksService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(ANALYSIS_QUEUE) private readonly analysisQueue: Queue,
  ) {}

  async submitTask(batchId: string, batchName: string, waferCount: number): Promise<TaskMeta> {
    const lockKey = BATCH_LOCK_PREFIX + batchId;
    const locked = await this.redis.set(lockKey, '1', 'EX', 600, 'NX');

    if (!locked) {
      const existing = await this.redis.keys(TASK_META_PREFIX + '*');
      for (const key of existing) {
        const meta = await this.getTaskMeta(key.replace(TASK_META_PREFIX, ''));
        if (meta && meta.batchId === batchId && (meta.status === 'queued' || meta.status === 'running')) {
          return meta;
        }
      }
      await this.redis.del(lockKey);
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const meta: TaskMeta = {
      taskId,
      batchId,
      batchName,
      waferCount,
      createdAt: Date.now(),
      status: 'queued',
      progress: { phase: '等待调度', percent: 0, message: '任务已加入队列' },
    };

    await this.redis.setex(TASK_META_PREFIX + taskId, TASK_TTL, JSON.stringify(meta));

    await this.analysisQueue.add(BULLMQ_QUEUE, {
      taskId,
      batchId,
      batchName,
      waferCount,
    }, {
      jobId: taskId,
      priority: batchName.startsWith('URGENT') ? 1 : 10,
    });

    return meta;
  }

  async getTaskMeta(taskId: string): Promise<TaskMeta | null> {
    const raw = await this.redis.get(TASK_META_PREFIX + taskId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async updateTaskMeta(taskId: string, updates: Partial<TaskMeta>): Promise<void> {
    const existing = await this.getTaskMeta(taskId);
    if (!existing) throw new NotFoundException(`Task ${taskId} not found`);

    const merged: TaskMeta = { ...existing, ...updates };
    await this.redis.setex(TASK_META_PREFIX + taskId, TASK_TTL, JSON.stringify(merged));
  }

  async updateProgress(taskId: string, phase: string, percent: number, message: string): Promise<void> {
    await this.updateTaskMeta(taskId, {
      progress: { phase, percent, message },
    });
  }

  async getResult(taskId: string): Promise<AnalysisResult | null> {
    const raw = await this.redis.get(TASK_RESULT_PREFIX + taskId);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async saveResult(taskId: string, result: AnalysisResult): Promise<void> {
    await this.redis.setex(TASK_RESULT_PREFIX + taskId, TASK_TTL, JSON.stringify(result));
  }

  async setCompleted(taskId: string): Promise<void> {
    await this.updateTaskMeta(taskId, {
      status: 'completed',
      completedAt: Date.now(),
      progress: { phase: '完成', percent: 100, message: '分析完成' },
    });
    await this.redis.del(BATCH_LOCK_PREFIX + (await this.getTaskMeta(taskId))?.batchId || '');
  }

  async setFailed(taskId: string, error: string): Promise<void> {
    await this.updateTaskMeta(taskId, {
      status: 'failed',
      completedAt: Date.now(),
      error,
      progress: { phase: '失败', percent: 100, message: error },
    });
    const meta = await this.getTaskMeta(taskId);
    if (meta) {
      await this.redis.del(BATCH_LOCK_PREFIX + meta.batchId);
    }
  }

  async listTasks(batchId?: string): Promise<TaskMeta[]> {
    const keys = await this.redis.keys(TASK_META_PREFIX + '*');
    const tasks: TaskMeta[] = [];

    for (const key of keys) {
      const meta = await this.getTaskMeta(key.replace(TASK_META_PREFIX, ''));
      if (meta && (!batchId || meta.batchId === batchId)) {
        tasks.push(meta);
      }
    }

    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  async cancelTask(taskId: string): Promise<void> {
    const meta = await this.getTaskMeta(taskId);
    if (!meta) throw new NotFoundException(`Task ${taskId} not found`);
    if (meta.status === 'completed' || meta.status === 'failed') {
      throw new BadRequestException('Task already finished');
    }

    const job = await this.analysisQueue.getJob(taskId);
    if (job) {
      await job.remove();
    }

    await this.updateTaskMeta(taskId, {
      status: 'failed',
      completedAt: Date.now(),
      error: '任务被手动取消',
    });

    await this.redis.del(BATCH_LOCK_PREFIX + meta.batchId);
  }

  async getTaskOrThrow(taskId: string): Promise<TaskMeta> {
    const meta = await this.getTaskMeta(taskId);
    if (!meta) throw new NotFoundException(`Task ${taskId} not found`);
    return meta;
  }
}
