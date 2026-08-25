import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  // Disable built-in body parser so we can set a higher limit (screenshots are large base64 strings)
  const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Security headers
  app.use(helmet());
  app.use(cookieParser());

  // CORS — allow web app
  app.enableCors({
    origin: config.get<string>('WEB_BASE_URL', 'http://localhost:3000'),
    credentials: true,
  });

  // API prefix
  app.setGlobalPrefix('api');

  // Global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global exception filter (normalizes errors to OpenAPI ErrorResponse)
  app.useGlobalFilters(new AllExceptionsFilter());

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT', 3001);
  await app.listen(port);
  logger.log(`🚀 API ready on http://localhost:${port}/api`);
  logger.log(`📦 Environment: ${config.get<string>('NODE_ENV', 'development')}`);
}

bootstrap();
