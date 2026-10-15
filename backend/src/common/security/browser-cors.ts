import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { CSRF_HEADER } from '../../session/constants/browser-proof';

const BROWSER_CORS_MAX_AGE_SECONDS = 600;

export function browserCors(origins: string | readonly string[]): CorsOptions {
  return {
    origin:
      typeof origins === 'string'
        ? origins
        : (origin, callback) => {
            callback(
              null,
              origin !== undefined && origins.includes(origin) ? origin : false,
            );
          },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', CSRF_HEADER],
    exposedHeaders: [CSRF_HEADER],
    maxAge: BROWSER_CORS_MAX_AGE_SECONDS,
  };
}
