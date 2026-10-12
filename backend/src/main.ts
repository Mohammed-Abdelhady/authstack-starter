import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Express } from 'express';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import { reconcileStartupApplications } from './session/session.module';
import { SessionCookieService } from './auth/services/sessions/session-cookie.service';
import { ErrorResponse, ErrorDetails } from './common/dto/api-response.dto';
import { DEVELOPMENT_CONTENT_SECURITY_POLICY } from './common/security/content-security-policy';
import { browserCors } from './common/security/browser-cors';
import { buildOpenApiDocument } from './common/swagger/build-openapi-document';
import { createValidationPipe } from './common/pipes/validation-pipe.factory';
import { startupEnvironmentWarning } from './config/utils/production-environment.util';

/**
 * Bootstrap the NestJS application
 * Configures security middleware, CORS, validation, and starts the server
 */
const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);
  const configService = app.get<ConfigService>(ConfigService);

  // Let custom class-validator constraints resolve providers, such as the OAuth registry
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  // Set global prefix for all routes except health check
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // 1. Security Headers - Apply first for all requests
  app.use(
    helmet({
      contentSecurityPolicy:
        configService.get('NODE_ENV') === 'production'
          ? undefined
          : DEVELOPMENT_CONTENT_SECURITY_POLICY,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // 2. Cookie Parser Middleware - Parse cookies from requests
  app.use(cookieParser());

  // 3. CORS Configuration - Apply before routing
  const clientUrl = configService.get<string>(
    'CLIENT_URL',
    'http://localhost:3000',
  );
  app.enableCors(browserCors(clientUrl));

  // 3. Global Validation Pipe - Validate all incoming DTOs
  app.useGlobalPipes(createValidationPipe());

  // 5. Rate Limiting - Applied via ThrottlerGuard in AppModule

  // 6. Get port and environment for logging
  const port = configService.get<number>('PORT', 3000);
  const environment = configService.get<string>('NODE_ENV', 'development');

  // 7. Swagger/OpenAPI Documentation
  const swaggerEnabled = configService.get<boolean>('swagger.enabled', false);
  if (swaggerEnabled) {
    const sessionCookieService = app.get(SessionCookieService);
    const document = SwaggerModule.createDocument(
      app,
      buildOpenApiDocument(sessionCookieService.name),
      {
        extraModels: [ErrorResponse, ErrorDetails],
      },
    );
    SwaggerModule.setup('api/docs', app, document);

    logger.log(`Swagger UI at http://localhost:${port}/api/docs`);
    logger.log(`OpenAPI spec at http://localhost:${port}/api/docs-json`);
  }

  // 8. Startup Logging
  logger.log(`Environment: ${environment}`);
  const environmentWarning = startupEnvironmentWarning(environment, clientUrl);
  if (environmentWarning) {
    logger.warn(environmentWarning);
  }
  logger.log(`Server URL: http://localhost:${port}`);
  logger.log(`Health check: http://localhost:${port}/health`);
  logger.log(`CORS origin: ${clientUrl}`);

  // 9. Graceful Shutdown
  app.enableShutdownHooks();

  await reconcileStartupApplications(app);

  // 10. Start Server
  await app.listen(port);

  logger.log(`Server listening on port ${port}`);
}

bootstrap().catch((error: unknown) => {
  logger.error(
    `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
