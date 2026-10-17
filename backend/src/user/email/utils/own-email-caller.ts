import type { RequestWithUser } from '../../../auth/guards/auth.guard';
import type { OwnEmailCaller } from '../types/own-email';
import { sessionEnded } from './own-email-errors';

/**
 * The account and session the guard let in. The account is always the
 * session's, never an id from the request.
 *
 * @throws AppException SESSION_INVALID when the guard left no session
 */
export function ownEmailCaller(request: RequestWithUser): OwnEmailCaller {
  const session = request.session;
  const user = request.user;
  if (!session || !user) throw sessionEnded();
  return {
    userId: user.id,
    sessionId: session.id,
    clientId: session.clientId,
    signedInAt: session.authenticatedAt,
    credentialPurpose: session.credentialPurpose,
  };
}
