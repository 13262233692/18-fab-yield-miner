import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Body,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('wafermap')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
        },
      }),
    }),
  )
  async uploadWaferMap(
    @UploadedFile() file: Express.Multer.File,
    @Body('batchName') batchName: string,
    @Body('productName') productName: string,
  ) {
    if (!file) {
      return { error: 'No file uploaded' };
    }

    const result = await this.uploadService.uploadWaferMap(
      batchName || 'default',
      productName || 'default',
      file.path,
    );

    return {
      success: true,
      ...result,
    };
  }

  @Get('sample')
  generateSample(
    @Query('batchName') batchName: string = 'SAMPLE001',
    @Query('waferCount') waferCount: string = '5',
    @Query('defectsPerWafer') defectsPerWafer: string = '1000',
    @Res() res: Response,
  ) {
    const wafers = this.uploadService.generateSampleData(
      batchName,
      parseInt(waferCount),
      parseInt(defectsPerWafer),
    );

    const lines = ['wafer_id,defect_x,defect_y,defect_size,defect_class'];

    wafers.forEach((wafer) => {
      wafer.defects.forEach((defect) => {
        lines.push(
          `${wafer.waferId},${defect.x.toFixed(4)},${defect.y.toFixed(4)},${defect.size.toFixed(4)},${defect.defectClass}`,
        );
      });
    });

    const content = lines.join('\n');
    const filename = `${batchName}_defects.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }
}
