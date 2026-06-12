import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.setGlobalPrefix('api');
  await app.listen(3000);
  console.log('Backend running on http://localhost:3000');
}
bootstrap();
