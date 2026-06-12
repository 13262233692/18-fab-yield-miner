import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Defect } from './defect.entity';

export interface TileQueryParams {
  batchId: string;
  waferId?: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  resolution?: number;
}

export interface AggregatedDefect {
  x: number;
  y: number;
  count: number;
  avgSize: number;
}

@Injectable()
export class DefectsService {
  constructor(
    @InjectRepository(Defect)
    private defectsRepository: Repository<Defect>,
    private dataSource: DataSource,
  ) {}

  async findAll(batchId: string, waferId?: string): Promise<Defect[]> {
    const where: any = { batchId };
    if (waferId) where.waferId = waferId;
    return this.defectsRepository.find({ where, take: 10000 });
  }

  async getTile(params: TileQueryParams): Promise<AggregatedDefect[]> {
    const { batchId, waferId, xMin, yMin, xMax, yMax, resolution = 200 } = params;

    const tileWidth = (xMax - xMin) / resolution;
    const tileHeight = (yMax - yMin) / resolution;

    const waferCondition = waferId ? `AND wafer_id = '${waferId}'` : '';

    const query = `
      SELECT
        (floor((ST_X(geom) - $1) / $2) * $2 + $1 + $2 / 2)::float as x,
        (floor((ST_Y(geom) - $3) / $4) * $4 + $3 + $4 / 2)::float as y,
        COUNT(*)::int as count,
        AVG(defect_size)::float as avg_size
      FROM defects
      WHERE batch_id = $5
        ${waferCondition}
        AND geom && ST_MakeEnvelope($1, $3, $6, $7, 0)
      GROUP BY floor((ST_X(geom) - $1) / $2), floor((ST_Y(geom) - $3) / $4)
      ORDER BY count DESC
    `;

    const result = await this.dataSource.query(query, [
      xMin,
      tileWidth,
      yMin,
      tileHeight,
      batchId,
      xMax,
      yMax,
    ]);

    return result.map((row: any) => ({
      x: parseFloat(row.x),
      y: parseFloat(row.y),
      count: parseInt(row.count),
      avgSize: parseFloat(row.avg_size) || 0,
    }));
  }

  async getWaferHeatmap(batchId: string, waferId: string, gridSize = 100): Promise<AggregatedDefect[]> {
    const query = `
      WITH wafer_bounds AS (
        SELECT
          MIN(ST_X(geom)) as min_x,
          MAX(ST_X(geom)) as max_x,
          MIN(ST_Y(geom)) as min_y,
          MAX(ST_Y(geom)) as max_y
        FROM defects
        WHERE batch_id = $1 AND wafer_id = $2
      )
      SELECT
        (floor((ST_X(geom) - wb.min_x) / ((wb.max_x - wb.min_x) / $3)) * ((wb.max_x - wb.min_x) / $3) + wb.min_x + ((wb.max_x - wb.min_x) / $3) / 2)::float as x,
        (floor((ST_Y(geom) - wb.min_y) / ((wb.max_y - wb.min_y) / $3)) * ((wb.max_y - wb.min_y) / $3) + wb.min_y + ((wb.max_y - wb.min_y) / $3) / 2)::float as y,
        COUNT(*)::int as count,
        AVG(defect_size)::float as avg_size
      FROM defects, wafer_bounds wb
      WHERE batch_id = $1 AND wafer_id = $2
      GROUP BY
        floor((ST_X(geom) - wb.min_x) / ((wb.max_x - wb.min_x) / $3)),
        floor((ST_Y(geom) - wb.min_y) / ((wb.max_y - wb.min_y) / $3))
      ORDER BY count DESC
    `;

    const result = await this.dataSource.query(query, [batchId, waferId, gridSize]);

    return result.map((row: any) => ({
      x: parseFloat(row.x),
      y: parseFloat(row.y),
      count: parseInt(row.count),
      avgSize: parseFloat(row.avg_size) || 0,
    }));
  }

  async getSpatialClusters(batchId: string, eps = 5.0, minPoints = 10): Promise<any[]> {
    const query = `
      SELECT
        ST_AsGeoJSON(ST_Collect(geom)) as cluster_geom,
        cluster_id,
        COUNT(*) as defect_count,
        ST_X(ST_Centroid(ST_Collect(geom))) as centroid_x,
        ST_Y(ST_Centroid(ST_Collect(geom))) as centroid_y
      FROM (
        SELECT
          geom,
          ST_ClusterDBSCAN(geom, eps := $1, minpoints := $2) OVER () as cluster_id
        FROM defects
        WHERE batch_id = $3
      ) sub
      WHERE cluster_id IS NOT NULL
      GROUP BY cluster_id
      ORDER BY defect_count DESC
      LIMIT 50
    `;

    const result = await this.dataSource.query(query, [eps, minPoints, batchId]);

    return result.map((row: any) => ({
      clusterId: row.cluster_id,
      defectCount: parseInt(row.defect_count),
      centroidX: parseFloat(row.centroid_x),
      centroidY: parseFloat(row.centroid_y),
      clusterGeom: JSON.parse(row.cluster_geom),
    }));
  }

  async getWaferList(batchId: string): Promise<string[]> {
    const result = await this.defectsRepository
      .createQueryBuilder('defect')
      .select('DISTINCT defect.waferId', 'waferId')
      .where('defect.batchId = :batchId', { batchId })
      .orderBy('defect.waferId')
      .getRawMany();

    return result.map((row) => row.waferId);
  }

  async getDefectAtPoint(batchId: string, x: number, y: number, radius = 1.0): Promise<Defect[]> {
    const query = `
      SELECT * FROM defects
      WHERE batch_id = $1
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($2, $3), 0), $4)
      ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 0))
      LIMIT 10
    `;

    return this.dataSource.query(query, [batchId, x, y, radius]);
  }

  async batchInsert(defects: Array<Partial<Defect>>): Promise<void> {
    if (defects.length === 0) return;

    const chunkSize = 1000;
    for (let i = 0; i < defects.length; i += chunkSize) {
      const chunk = defects.slice(i, i + chunkSize);
      await this.defectsRepository
        .createQueryBuilder()
        .insert()
        .into(Defect)
        .values(chunk)
        .orIgnore()
        .execute();
    }
  }

  async deleteByBatchId(batchId: string): Promise<void> {
    await this.defectsRepository.delete({ batchId });
  }
}
