import { Entity, Column, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Batch } from '../batches/batch.entity';

@Entity('defects')
export class Defect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'wafer_id' })
  @Index()
  waferId: string;

  @Column({ name: 'die_x' })
  dieX: number;

  @Column({ name: 'die_y' })
  dieY: number;

  @Column({ name: 'defect_x', type: 'float' })
  defectX: number;

  @Column({ name: 'defect_y', type: 'float' })
  defectY: number;

  @Column({ name: 'defect_size', type: 'float', nullable: true })
  defectSize: number;

  @Column({ name: 'defect_class', nullable: true })
  defectClass: string;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 0 })
  @Index({ spatial: true })
  geom: string;

  @Column({ name: 'batch_id' })
  @Index()
  batchId: string;

  @ManyToOne(() => Batch, (batch) => batch.defects)
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @Column({ type: 'timestamp', name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
