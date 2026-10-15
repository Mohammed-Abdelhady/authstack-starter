import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { Request } from 'express';
import type { BrowserApplications } from '../../session/applications/browser-applications';
import { CSRF_HEADER } from '../../session/constants/browser-proof';
import { ADMIN_CLIENT_ID } from '../../session/constants/client-ids';

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

/** CORS for the browser applications, from the request's one stored read. */
export function browserCorsDelegate(
  applications: BrowserApplications,
): CorsOptionsDelegate<Request> {
  return (request, callback) => {
    // Without an Origin no cross-origin read is allowed or refused, so health
    // checks and native callers never wait on the store here.
    const allowed =
      request.headers.origin === undefined
        ? Promise.resolve(applications.configuredOrigins())
        : applications.allowedOrigins(request);
    void allowed.then(
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
}
