import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger }  from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import * as helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Logger estructurado — reemplaza console.log
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService);
  const port   = config.get<number>('port', 4000);
  const isProd = config.get<string>('nodeEnv') === 'production';

  // ── Seguridad ──────────────────────────────────────────────────
  app.use((helmet as any)({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: isProd
      ? undefined
      : false, // Deshabilitar CSP en desarrollo para Swagger UI
  }));

  // ── Cookies ────────────────────────────────────────────────────
  app.use(cookieParser());

  // ── CORS ───────────────────────────────────────────────────────
  const corsOrigins = config.get<string[]>('cors.origins', ['http://localhost:3001']);
  app.enableCors({
    origin:      corsOrigins,
    credentials: true,               // Necesario para enviar cookies cross-origin
    methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // ── Validación global ──────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:        true,   // Elimina propiedades no declaradas en DTOs
      forbidNonWhitelisted: true,
      transform:        true,   // Transforma tipos automáticamente
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Prefijo global de API ──────────────────────────────────────
  app.setGlobalPrefix('api');

  // ── Swagger — solo en no-producción ───────────────────────────
  if (!isProd) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('IAM Core API')
      .setDescription('Plataforma centralizada de Gestión de Identidad y Acceso')
      .setVersion('1.0')
      .addCookieAuth('access_token')
      .addBearerAuth()
      .addTag('auth',  'Autenticación y gestión de sesiones')
      .addTag('admin', 'Administración de usuarios, servicios y accesos')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });

    logger.log(`📚 Swagger disponible en: http://localhost:${port}/api/docs`);
  }

  await app.listen(port);

  logger.log(`🚀 IAM Core corriendo en: http://localhost:${port}/api`);
  logger.log(`🌍 Entorno: ${config.get('nodeEnv')}`);
  logger.log(`🔐 JWT issuer: ${config.get('jwt.issuer')}`);
}

bootstrap().catch((err) => {
  console.error('Error iniciando IAM Core:', err);
  process.exit(1);
});
