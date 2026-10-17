import { Sessions } from '../../src/auth/services/sessions/sessions';
import { ROLE_AUDIENCE } from '../../src/host/types/host-role.type';
import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import { MAX_SESSIONS_PER_USER } from '../../src/session/constants/session-policy';
import { SessionIssuanceService } from '../../src/session/services/session-issuance.service';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import type { E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  bootEnrolmentApp,
  ENROLMENT_CREDENTIAL_ID,
  issueEnrolment,
  promoteEnrolment,
} from '../utils/session/enrolment-fixtures';
import { storeBrowserPolicy } from '../utils/session/store-browser-policy';

describe('enrolment issuance refusals', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootEnrolmentApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  // Failure: a proof claim promotes a missing credential or another user's key.
  it.each(['absent', 'other-user'])(
    'refuses an %s credential without retiring the enrolment',
    async (credential) => {
      const issued = await issueEnrolment(e2e);
      const otherId = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
      if (!otherId) throw new Error('Other fixture account is missing');
      await expect(
        promoteEnrolment(e2e, issued, {
          insertCredential: credential !== 'absent',
          credentialOwnerId: otherId,
        }),
      ).rejects.toMatchObject({
        code: 'PASSKEY_CHALLENGE_INVALID',
        status: 401,
      });
      const stored = e2e.state.enrolment;
      expect(await stored.count(issued.userId)).toBe(0);
      expect(await stored.count(otherId)).toBe(0);
      expect(await stored.revocationReason(issued.session.id)).toBeNull();
      expect(
        await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
      ).toMatchObject({ id: issued.session.id });
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    },
  );

  // Failure: a credential of another relying party proves the enrolment's
  // first passkey, or one stored before relying parties were recorded does not.
  it.each([
    { stored: 'another relying party', rpId: 'other.example.test' },
    { stored: 'no relying party on record', rpId: undefined },
  ])(
    'promotes on a credential with $stored only when it is the web one',
    async ({ rpId }) => {
      const issued = await issueEnrolment(e2e);
      await e2e.state.auth.storePasskey(SEED_USER.email, {
        credentialId: ENROLMENT_CREDENTIAL_ID,
        publicKey: Buffer.from([0, 255, 1, 128]),
        counter: 0,
        transports: ['internal'],
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Stored before enrolment',
        lastUsedAt: null,
        ...(rpId ? { rpId } : {}),
      });
      const promotion = promoteEnrolment(e2e, issued, {
        insertCredential: false,
      });
      if (rpId === undefined) {
        expect(await promotion).toMatchObject({ clientId: WEB_CLIENT_ID });
        return;
      }
      await expect(promotion).rejects.toMatchObject({
        code: 'PASSKEY_CHALLENGE_INVALID',
        status: 401,
      });
      expect(
        await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
      ).toMatchObject({ id: issued.session.id });
    },
  );

  // Failure: changed audience leaks the issuer error or rolls back its refusal audit.
  it('translates audience refusal after rollback and retains its failed event', async () => {
    const issued = await issueEnrolment(e2e);
    await storeBrowserPolicy(
      e2e,
      WEB_CLIENT_ID,
      { accountAudience: ROLE_AUDIENCE.STAFF },
      false,
    );
    await expect(promoteEnrolment(e2e, issued)).rejects.toMatchObject({
      code: 'PASSKEY_CHALLENGE_INVALID',
      status: 401,
    });
    const stored = e2e.state.enrolment;
    expect(await stored.count(issued.userId)).toBe(0);
    expect(await stored.revocationReason(issued.session.id)).toBeNull();
    expect(await stored.audienceRefusals(issued.userId)).toEqual([
      { clientId: WEB_CLIENT_ID, outcome: 'failed' },
    ]);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  // Failure: hitting the cap leaks SESSION_LIMIT_REACHED or commits partial promotion.
  it('translates a session cap refusal and leaves the enrolment live', async () => {
    const issued = await issueEnrolment(e2e);
    const issuer = e2e.app.get(SessionIssuanceService);
    for (let index = 0; index < MAX_SESSIONS_PER_USER; index += 1) {
      await issuer.createBrowserSession(
        issued.userId,
        'Enrolment cap fixture/1',
        '127.0.0.1',
        WEB_CLIENT_ID,
        { authenticationMethods: ['passkey'], userVerified: true },
      );
    }
    await expect(promoteEnrolment(e2e, issued)).rejects.toMatchObject({
      code: 'PASSKEY_CHALLENGE_INVALID',
      status: 401,
    });
    const stored = e2e.state.enrolment;
    expect(await stored.count(issued.userId)).toBe(0);
    expect(await stored.revocationReason(issued.session.id)).toBeNull();
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toMatchObject({ id: issued.session.id });
    expect(await e2e.state.sessions.countSessions()).toBe(21);
  });
});
