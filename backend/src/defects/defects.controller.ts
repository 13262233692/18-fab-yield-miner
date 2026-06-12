import { Controller, Get, Param, Query, Delete, ParseFloatPipe } from '@nestjs/common';
import { DefectsService } from './defects.service';
import { Defect } from './defect.entity';

@Controller('defects')
export class DefectsController {
  constructor(private readonly defectsService: DefectsService) {}

  @Get('tile')
  getTile(
    @Query('batchId') batchId: string,
    @Query('waferId') waferId: string,
    @Query('xMin', ParseFloatPipe) xMin: number,
    @Query('yMin', ParseFloatPipe) yMin: number,
    @Query('xMax', ParseFloatPipe) xMax: number,
    @Query('yMax', ParseFloatPipe) yMax: number,
    @Query('resolution') resolution?: string,
  ) {
    return this.defectsService.getTile({
      batchId,
      waferId,
      xMin,
      yMin,
      xMax,
      yMax,
      resolution: resolution ? parseInt(resolution) : undefined,
    });
  }

  @Get('heatmap/:batchId/:waferId')
  getWaferHeatmap(
    @Param('batchId') batchId: string,
    @Param('waferId') waferId: string,
    @Query('gridSize') gridSize?: string,
  ) {
    return this.defectsService.getWaferHeatmap(
      batchId,
      waferId,
      gridSize ? parseInt(gridSize) : 100,
    );
  }

  @Get('clusters/:batchId')
  getSpatialClusters(
    @Param('batchId') batchId: string,
    @Query('eps') eps?: string,
    @Query('minPoints') minPoints?: string,
  ) {
    return this.defectsService.getSpatialClusters(
      batchId,
      eps ? parseFloat(eps) : 5.0,
      minPoints ? parseInt(minPoints) : 10,
    );
  }

  @Get('wafers/:batchId')
  getWaferList(@Param('batchId') batchId: string): Promise<string[]> {
    return this.defectsService.getWaferList(batchId);
  }

  @Get('pick')
  getDefectAtPoint(
    @Query('batchId') batchId: string,
    @Query('x', ParseFloatPipe) x: number,
    @Query('y', ParseFloatPipe) y: number,
    @Query('radius') radius?: string,
  ): Promise<Defect[]> {
    return this.defectsService.getDefectAtPoint(
      batchId,
      x,
      y,
      radius ? parseFloat(radius) : 1.0,
    );
  }

  @Get(':batchId')
  findAll(
    @Param('batchId') batchId: string,
    @Query('waferId') waferId?: string,
  ): Promise<Defect[]> {
    return this.defectsService.findAll(batchId, waferId);
  }

  @Delete(':batchId')
  deleteByBatchId(@Param('batchId') batchId: string): Promise<void> {
    return this.defectsService.deleteByBatchId(batchId);
  }
}
