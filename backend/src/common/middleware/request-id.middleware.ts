import { Injectable, NestMiddleware } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestWithId } from '../interfaces/request-with-id.interface';
import {
  REQUEST_ID_HEADER,
  REQUEST_ID_MAX_LENGTH,
  REQUEST_ID_PATTERN,
} from '../constants/request-id';
import { runWithRequestContext } from '../context/request-context';

/**
 * Gives every request a correlation id.
 *
 * An incoming X-Request-Id is reused when it is short and made of id-safe
 * characters, so a proxy can trace a request end to end. Anything else is
 * replaced with a fresh UUID. The id goes on the request for the logger and the
 * exception filter, and on the response header for the caller.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const requestId = this.resolveId(request.header(REQUEST_ID_HEADER));

    request.requestId = requestId;
    response.setHeader(REQUEST_ID_HEADER, requestId);

    runWithRequestContext(
      requestId,
      () => next(),
      request.header('user-agent'),
    );
  }

  private resolveId(incoming: string | undefined): string {
    if (
      incoming &&
      incoming.length <= REQUEST_ID_MAX_LENGTH &&
      REQUEST_ID_PATTERN.test(incoming)
    ) {
      return incoming;
    }

    return randomUUID();
  }
}
