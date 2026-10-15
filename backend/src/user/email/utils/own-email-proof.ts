import { FRESH_PROOF_REQUIREMENT } from '../../../auth/contracts/constants/fresh-proof';
import { FreshProofCheck } from '../../../auth/contracts/fresh-proof';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { OwnEmailCaller } from '../types/own-email';
import { signInAgain } from './own-email-errors';

/**
 * A sign-in within the window, or a passkey proof made on this session. Age is
 * accepted even where the application requires passkeys: such a session was
 * itself signed in with one.
 *
 * @throws AppException REAUTH_REQUIRED when the session holds neither
 */
export async function assertFreshProof(
  check: FreshProofCheck,
  unitOfWork: UnitOfWork,
  caller: OwnEmailCaller,
): Promise<void> {
  const fresh = await check.isFresh(unitOfWork, {
    userId: caller.userId,
    clientId: caller.clientId,
    sessionId: caller.sessionId,
    signedInAt: caller.signedInAt,
    requirement: FRESH_PROOF_REQUIREMENT.ACT_OR_AGE,
    requirePasskey: false,
  });
  if (!fresh) throw signInAgain();
}
