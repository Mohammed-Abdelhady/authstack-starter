// feature:passkeys:start
import { ConfigService } from '@nestjs/config';
import type { PromotedEnrolmentSession } from '../../../src/auth/contracts/types/enrolment-promotion';
import type { VerifiedPasskeyProof } from '../../../src/auth/contracts/types/passkey-proof';
import { EnrolmentPromotion } from '../../../src/auth/contracts/enrolment-promotion';
import { SessionCookieService } from '../../../src/auth/services/sessions/session-cookie.service';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { SessionAuthorityStore } from '../../../src/session/authority/session-authority.store';
import { WEB_CLIENT_ID } from '../../../src/session/constants/client-ids';
import { SECURITY_EVENT_ACTION } from '../../../src/session/constants/security-event-action';
import { SecurityEventStore } from '../../../src/session/events/security-event.store';
import { SessionIssuanceService } from '../../../src/session/services/session-issuance.service';
import { hashToken } from '../../../src/session/utils/hashing/token-hash';
import { SEED_USER } from '../../constants/seed-users';
import { ADMIN_ORIGIN } from '../audience-authorization.fixtures';
import { bootE2eApp, E2E_CLIENT_URL, type E2eApp } from '../e2e-app';
import { enrolmentCredentialFixture } from './enrolment-credential-fixture';
import { storeBrowserPolicy } from './store-browser-policy';

export const ENROLMENT_ORIGIN = E2E_CLIENT_URL;
export const ENROLMENT_RP_ID = new URL(ENROLMENT_ORIGIN).hostname;
export const ENROLMENT_CREDENTIAL_ID = 'ZW5yb2xtZW50LWNyZWRlbnRpYWw';

export async function bootEnrolmentApp(): Promise<E2eApp> {
  const e2e = await bootE2eApp(0, {
    beforeStart: (app) => {
      const config = app.get(ConfigService);
      config.set('passkeys.enabled', true);
      config.set('passkeys.rpId', ENROLMENT_RP_ID);
      config.set('passkeys.origin', ENROLMENT_ORIGIN);
      config.set('cors.adminUrl', ADMIN_ORIGIN);
    },
  });
  const storePolicy = () =>
    storeBrowserPolicy(e2e, WEB_CLIENT_ID, { requirePasskey: true });
  try {
    await storePolicy();
  } catch (error) {
    await e2e.close().catch(() => undefined);
    throw error;
  }
  return {
    ...e2e,
    reset: async () => {
      await e2e.reset();
      await storePolicy();
    },
  };
}

export async function issueEnrolment(e2e: E2eApp) {
  const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
  if (!userId) throw new Error('Enrolment fixture account is missing');
  const issued = await e2e.app
    .get(UnitOfWorkRunner)
    .run((work) =>
      e2e.app
        .get(SessionIssuanceService)
        .createEnrolmentSessionIn(
          work,
          userId,
          'Enrolment contract/1',
          '127.0.0.1',
          WEB_CLIENT_ID,
        ),
    );
  const stored = await e2e.app
    .get(SessionAuthorityStore)
    .readCommittedSessionByTokenHash(hashToken(issued.sessionToken));
  if (!stored) throw new Error('Enrolment issuer stored no session');
  const cookieName = e2e.app.get(SessionCookieService).nameFor(WEB_CLIENT_ID);
  return {
    ...issued,
    userId,
    session: stored,
    cookie: `${cookieName}=${issued.sessionToken}`,
  };
}

export type IssuedEnrolment = Awaited<ReturnType<typeof issueEnrolment>>;

/** The simulated credential insert and the host hook share the real transaction. */
export async function promoteEnrolment(
  e2e: E2eApp,
  enrolment: IssuedEnrolment,
  options: {
    proof?: Partial<VerifiedPasskeyProof>;
    sessionId?: string;
    clientId?: string;
    abort?: Error;
    insertCredential?: boolean;
    credentialOwnerId?: string;
  } = {},
): Promise<PromotedEnrolmentSession | undefined> {
  const credentials = await enrolmentCredentialFixture(e2e.app);
  const promotion = e2e.app.get(EnrolmentPromotion);
  return promotion.withRefusalRecorded(() =>
    e2e.app.get(UnitOfWorkRunner).run(async (work) => {
      if (options.insertCredential !== false) {
        await credentials.insertIn(
          work,
          options.credentialOwnerId ?? enrolment.userId,
          ENROLMENT_CREDENTIAL_ID,
          e2e.clock.now(),
        );
      }
      await promotion.promoteAfterFirstPasskey(work, {
        sessionId: options.sessionId ?? enrolment.session.id,
        userId: enrolment.userId,
        clientId: options.clientId ?? WEB_CLIENT_ID,
        proof: {
          userId: enrolment.userId,
          credentialId: ENROLMENT_CREDENTIAL_ID,
          rpId: ENROLMENT_RP_ID,
          userVerified: true,
          ...options.proof,
        },
      });
      const receipt = promotion.takePromotedSessionIn(work);
      if (options.abort) throw options.abort;
      return receipt;
    }),
  );
}

/** The session revocations recorded for the account, with their reasons. */
export async function sessionRevocations(e2e: E2eApp, userId: string) {
  const events = await e2e.app
    .get(SecurityEventStore)
    .listRecentForUser(userId, 50);
  return events
    .filter(({ action }) => action === SECURITY_EVENT_ACTION.SESSION_REVOKED)
    .map(({ sessionId, reasonCode }) => ({ sessionId, reasonCode }));
}
// feature:passkeys:end
