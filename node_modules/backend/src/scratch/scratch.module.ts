import { Module } from '@nestjs/common';
import { ScratchDetectionService } from './scratch-detection.service';
import { ScratchController } from './scratch.controller';
import { ScratchDetectionProcessor } from '../processors/scratch-detection.processor';
import { TasksModule } from '../tasks/tasks.module';
import { DefectsModule } from '../defects/defects.module';
import { QueueModule } from '../queue/queue.module';
import { BullModule } from '@nestjs/bullmq';
import { BULLMQ_QUEUE } from '../queue/queue.module';

@Module({
  imports: [
    QueueModule,
    BullModule.registerQueue({ name: BULLMQ_QUEUE }),
    TasksModule,
    DefectsModule,
  ],
  providers: [ScratchDetectionService, ScratchDetectionProcessor],
  controllers: [ScratchController],
  exports: [ScratchDetectionService],
})
export class ScratchModule {}
