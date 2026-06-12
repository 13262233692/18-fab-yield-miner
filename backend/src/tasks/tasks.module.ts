import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { OverlapAnalysisProcessor } from '../processors/overlap-analysis.processor';
import { QueueModule, BULLMQ_QUEUE } from '../queue/queue.module';
import { BatchesModule } from '../batches/batches.module';
import { DefectsModule } from '../defects/defects.module';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({
      name: BULLMQ_QUEUE,
    }),
    BatchesModule,
    DefectsModule,
  ],
  providers: [TasksService, OverlapAnalysisProcessor],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
