import { HttpStatus } from '@nestjs/common';
import type { RequestWithUser } from '../../../auth/guards/auth.guard';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import type { ProviderLinkCaller } from '../types/provider-link';

/**
 * The account and session the guard let in. The account is always the
 * session's, never an id from the request.
 *
 * @throws AppException SESSION_INVALID when the guard left no session
 */
export function providerLinkCaller(
  request: RequestWithUser,
): ProviderLinkCaller {
  const session = request.session;
  const user = request.user;
  if (!session || !user) {
    throw new AppException(
      ErrorCode.SESSION_INVALID,
      'Current session is no longer active',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return {
    userId: user.id,
    sessionId: session.id,
    clientId: session.clientId,
    signedInAt: session.authenticatedAt,
  };
}
