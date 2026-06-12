import { Module } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { DefectsModule } from '../defects/defects.module';
import { BatchesModule } from '../batches/batches.module';

@Module({
  imports: [DefectsModule, BatchesModule],
  providers: [UploadService],
  controllers: [UploadController],
})
export class UploadModule {}
