import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchesService } from './batches.service';
import { BatchesController } from './batches.controller';
import { Batch } from './batch.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Batch])],
  providers: [BatchesService],
  controllers: [BatchesController],
  exports: [BatchesService],
})
export class BatchesModule {}
