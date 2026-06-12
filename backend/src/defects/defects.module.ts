import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefectsService } from './defects.service';
import { DefectsController } from './defects.controller';
import { Defect } from './defect.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Defect])],
  providers: [DefectsService],
  controllers: [DefectsController],
  exports: [DefectsService],
})
export class DefectsModule {}
