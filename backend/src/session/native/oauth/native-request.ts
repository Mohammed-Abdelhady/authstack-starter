import { HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { resolveSessionCookieName } from '../../../auth/services/sessions/session-cookie.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

export function requestIp(request: Request): string {
  if (typeof request.ip === 'string' && request.ip.length > 0) {
    return request.ip;
  }
  return 'unknown';
}

export function requestUserAgent(request: Request): string {
  const header = request.headers['user-agent'];
  return typeof header === 'string' && header.trim().length > 0
    ? header
    : 'native';
}

export function readSessionCookie(
  request: Request,
  nodeEnv: string | undefined,
  configuredName: string | undefined,
): string | undefined {
  const cookies = request.cookies as Record<string, string> | undefined;
  const token = cookies?.[resolveSessionCookieName(nodeEnv, configuredName)];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * Refuses a consent action when the browser session changed to another
 * account after the page loaded. Every action names the account it was shown
 * to: the request body is refused before this when it names none.
 */
export function assertDisplayedAccount(
  sessionUserId: string,
  expectedUserId: string,
): void {
  if (expectedUserId === sessionUserId) {
    return;
  }
  throw new AppException(
    ErrorCode.NATIVE_AUTHORIZE_ACCOUNT_MISMATCH,
    'The signed-in account is not the one this request was shown to',
    HttpStatus.CONFLICT,
  );
}
