import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { ADMIN_CLIENT_ID } from '../constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../constants/credential-purpose';
import {
  MAX_ADMIN_SESSIONS_PER_USER,
  MAX_SESSIONS_PER_USER,
} from '../constants/session-policy';
import {
  BrowserIssuanceStore,
  IssuanceAccount,
  IssuanceApplication,
} from './browser-issuance.store';
import { currentSessionDeadlines } from '../utils/authority/session-authority-rule';
import { sessionLimitReached } from './session-issuance-errors';

export async function assertSessionLimitIn(
  store: BrowserIssuanceStore,
  authEpoch: number,
  unitOfWork: UnitOfWork,
  account: IssuanceAccount,
  application: IssuanceApplication,
  now: Date,
): Promise<void> {
  const candidates = await store.listSessionCapCandidates(unitOfWork, {
    userId: account.id,
    userVersion: account.sessionVersion,
    authEpoch,
    now,
    purposes: [
      CREDENTIAL_PURPOSE.BROWSER_SESSION,
      CREDENTIAL_PURPOSE.NATIVE_ACCESS,
    ],
  });
  const activeSessions = candidates.filter(
    (candidate) =>
      candidate.session.policyVersion ===
        (candidate.application?.policyVersion ?? 0) &&
      currentSessionDeadlines(
        candidate.session,
        account,
        candidate.application,
        candidate.grant,
        now,
        authEpoch,
        candidate.session.credentialPurpose,
      ) !== null,
  );
  if (
    sessionCapReached(
      application,
      activeSessions.map(({ session }) => session.clientId),
    )
  ) {
    throw sessionLimitReached();
  }
}

export function sessionCapReached(
  application: Pick<IssuanceApplication, 'clientId' | 'sessionCap'>,
  activeClientIds: readonly string[],
): boolean {
  const count = activeClientIds.filter(
    (clientId) => clientId === application.clientId,
  ).length;
  if (application.sessionCap !== undefined) {
    return count >= application.sessionCap;
  }
  return (
    activeClientIds.length >= MAX_SESSIONS_PER_USER ||
    (application.clientId === ADMIN_CLIENT_ID &&
      count >= MAX_ADMIN_SESSIONS_PER_USER)
  );
}
