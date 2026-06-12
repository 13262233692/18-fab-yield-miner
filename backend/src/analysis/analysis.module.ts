import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueModule } from '../queue/queue.module';
import { TasksModule } from '../tasks/tasks.module';
import { BatchesModule } from '../batches/batches.module';
import { ScratchDetectionProcessor } from './scratch-detection.processor';
import { ScratchController } from './scratch.controller';
import { SCRATCH_QUEUE } from './scratch-detection.processor';

@Module({
  imports: [
    QueueModule,
    TasksModule,
    BatchesModule,
    BullModule.registerQueue({ name: SCRATCH_QUEUE }),
  ],
  providers: [ScratchDetectionProcessor],
  controllers: [ScratchController],
})
export class AnalysisModule {}
