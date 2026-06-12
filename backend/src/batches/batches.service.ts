import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch } from './batch.entity';

@Injectable()
export class BatchesService {
  constructor(
    @InjectRepository(Batch)
    private batchesRepository: Repository<Batch>,
  ) {}

  async findAll(): Promise<Batch[]> {
    return this.batchesRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Batch> {
    return this.batchesRepository.findOne({ where: { id } });
  }

  async findByName(batchName: string): Promise<Batch> {
    return this.batchesRepository.findOne({ where: { batchName } });
  }

  async create(data: Partial<Batch>): Promise<Batch> {
    const batch = this.batchesRepository.create(data);
    return this.batchesRepository.save(batch);
  }

  async updateStats(batchId: string, waferCount: number, defectCount: number) {
    await this.batchesRepository.update(batchId, { waferCount, defectCount });
  }
}
