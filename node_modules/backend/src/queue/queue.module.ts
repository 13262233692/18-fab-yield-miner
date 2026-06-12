import { Module, Global } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const BULLMQ_QUEUE = 'overlap-analysis-queue';
export const REDIS_CLIENT = 'REDIS_CLIENT';
export const ANALYSIS_QUEUE = 'ANALYSIS_QUEUE';

const redisProvider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const redis = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redis.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    return redis;
  },
};

const queueProvider = {
  provide: ANALYSIS_QUEUE,
  useFactory: () => {
    const queue = new Queue(BULLMQ_QUEUE, {
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    queue.on('error', (err) => {
      console.error('[BullMQ] Queue error:', err.message);
    });

    return queue;
  },
};

@Global()
@Module({
  providers: [redisProvider, queueProvider],
  exports: [REDIS_CLIENT, ANALYSIS_QUEUE],
})
export class QueueModule {}
