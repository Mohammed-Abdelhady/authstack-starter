import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { requestLocale, SupportedLocale } from '../constants/locales';

/**
 * The language a request asks for: its body's `locale`, then
 * `Accept-Language`, then the default. The body field is validated by the
 * route's DTO; this reads the same value.
 */
export function requestLocaleOf(request: Request): SupportedLocale {
  const body: unknown = request.body;
  const bodyLocale: unknown =
    typeof body === 'object' && body !== null
      ? Reflect.get(body, 'locale')
      : undefined;
  return requestLocale(bodyLocale, request.headers['accept-language']);
}

/** The request's language as a handler parameter. */
export const RequestLocale = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    requestLocaleOf(ctx.switchToHttp().getRequest<Request>()),
);
