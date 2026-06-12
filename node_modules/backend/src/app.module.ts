import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DefectsModule } from './defects/defects.module';
import { BatchesModule } from './batches/batches.module';
import { UploadModule } from './upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'fab_yield',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
      logging: false,
      extra: {
        max: 20,
      },
    }),
    DefectsModule,
    BatchesModule,
    UploadModule,
  ],
})
export class AppModule {}
