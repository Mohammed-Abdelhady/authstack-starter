import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
} from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { RequestWithUser } from '../../guards/auth.guard';
import type { ActingSession } from '../types/acting-session';

/** The facts of the session the guard validated. Never request fields. */
export function actingSessionOf(request: RequestWithUser): ActingSession {
  const session = request.session;
  if (!session || !session.user) {
    throw new AppException(
      ErrorCode.SESSION_REQUIRED,
      'A signed-in session is required',
      HttpStatus.UNAUTHORIZED,
    );
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    clientId: session.clientId,
    signedInAt: session.authenticatedAt,
  };
}

/** `@ActingSessionOf() session: ActingSession` on a route behind the auth guard. */
export const ActingSessionOf = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ActingSession =>
    actingSessionOf(context.switchToHttp().getRequest<RequestWithUser>()),
);
