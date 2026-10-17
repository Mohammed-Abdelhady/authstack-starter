import { API_GLOBAL_PREFIX } from './common/constants/http-routes';
import { configureHttpApplication } from './common/security/configure-http-application';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { useContainer } from 'class-validator';
import { AppModule } from './app.module';
import { reconcileStartupApplications } from './session/session.module';
import { SessionCookieService } from './auth/services/sessions/session-cookie.service';
import { ErrorResponse, ErrorDetails } from './common/dto/api-response.dto';
import { buildOpenApiDocument } from './common/swagger/build-openapi-document';
import { startupEnvironmentWarning } from './config/utils/production-environment.util';

/**
 * Bootstrap the NestJS application
 * Configures security middleware, CORS, validation, and starts the server
 */
const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService>(ConfigService);

  // Let custom class-validator constraints resolve providers, such as the OAuth registry
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  configureHttpApplication(app);
  const clientUrl = configService.get<string>(
    'CLIENT_URL',
    'http://localhost:3000',
  );

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
    SwaggerModule.setup(`${API_GLOBAL_PREFIX}/docs`, app, document);

    logger.log(
      `Swagger UI at http://localhost:${port}/${API_GLOBAL_PREFIX}/docs`,
    );
    logger.log(
      `OpenAPI spec at http://localhost:${port}/${API_GLOBAL_PREFIX}/docs-json`,
    );
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

  await app.init();
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
