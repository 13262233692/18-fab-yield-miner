import { Entity, Column, PrimaryGeneratedColumn, OneToMany, Index } from 'typeorm';
import { Defect } from '../defects/defect.entity';

@Entity('batches')
export class Batch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_name', unique: true })
  @Index()
  batchName: string;

  @Column({ name: 'product_name', nullable: true })
  productName: string;

  @Column({ name: 'wafer_count', default: 0 })
  waferCount: number;

  @Column({ name: 'defect_count', default: 0 })
  defectCount: number;

  @Column({ name: 'wafer_diameter_mm', type: 'float', default: 300 })
  waferDiameterMm: number;

  @Column({ type: 'timestamp', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @OneToMany(() => Defect, (defect) => defect.batch)
  defects: Defect[];
}
