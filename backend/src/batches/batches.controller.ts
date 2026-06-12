import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { BatchesService } from './batches.service';
import { Batch } from './batch.entity';

@Controller('batches')
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  @Get()
  findAll(): Promise<Batch[]> {
    return this.batchesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Batch> {
    return this.batchesService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<Batch>): Promise<Batch> {
    return this.batchesService.create(data);
  }
}
