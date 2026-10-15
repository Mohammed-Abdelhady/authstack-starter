import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { SessionCookieService } from '../../auth/services/sessions/session-cookie.service';
import { ADMIN_CLIENT_ID } from '../../session/constants/client-ids';
import { API_GLOBAL_PREFIX, HEALTH_ROUTE } from '../constants/http-routes';
import { createValidationPipe } from '../pipes/validation-pipe.factory';
import { DEVELOPMENT_CONTENT_SECURITY_POLICY } from './content-security-policy';
import { browserCors } from './browser-cors';
import { nativeLinkHostMiddleware } from './native-link-host.middleware';

export function configureHttpApplication(app: INestApplication): void {
  const server = app.getHttpAdapter().getInstance() as Express;
  server.disable('x-powered-by');
  const config = app.get(ConfigService);
  const cookies = app.get(SessionCookieService);
  app.use(nativeLinkHostMiddleware(config, cookies.applications));
  server.set('trust proxy', 1);
  app.setGlobalPrefix(API_GLOBAL_PREFIX, { exclude: [HEALTH_ROUTE] });
  app.use(
    helmet({
      contentSecurityPolicy:
        config.get<string>('NODE_ENV') === 'production'
          ? undefined
          : DEVELOPMENT_CONTENT_SECURITY_POLICY,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(cookieParser());
  app.use((request: Request, _response: Response, next: NextFunction) => {
    void cookies.assertOrigin(request).then(
      () => next(),
      (error: unknown) => next(error),
    );
  });
  const applications = cookies.applications;
  const cors: CorsOptionsDelegate<Request> = (_request, callback) => {
    void applications.allowedOrigins().then(
      (origins) =>
        callback(
          null,
          browserCors(
            !applications.isConfigured(ADMIN_CLIENT_ID) && origins.length === 1
              ? origins[0]
              : origins,
          ),
        ),
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Error('Application read failed'),
          {},
        ),
    );
  };
  app.enableCors(cors);
  app.useGlobalPipes(createValidationPipe());
}
