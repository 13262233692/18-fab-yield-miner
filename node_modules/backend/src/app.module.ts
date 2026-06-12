import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { DefectsModule } from './defects/defects.module';
import { BatchesModule } from './batches/batches.module';
import { UploadModule } from './upload/upload.module';
import { TasksModule } from './tasks/tasks.module';
import { QueueModule } from './queue/queue.module';
import { BULLMQ_QUEUE } from './queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'fab_yield',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
      logging: false,
      poolSize: 40,
      extra: {
        max: 40,
        min: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      },
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    QueueModule,
    TasksModule,
    DefectsModule,
    BatchesModule,
    UploadModule,
  ],
})
export class AppModule {}
