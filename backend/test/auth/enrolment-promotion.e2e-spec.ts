import { EnrolmentPromotion } from '../../src/auth/contracts/enrolment-promotion';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { SessionAuthorityStore } from '../../src/session/authority/session-authority.store';
import { SessionValidator } from '../../src/session/authority/session-validator';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
import { CREDENTIAL_PURPOSE } from '../../src/session/constants/credential-purpose';
import { SessionIssuanceService } from '../../src/session/services/session-issuance.service';
import { SEED_ADMIN } from '../constants/seed-users';
import type { E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { enrolmentCredentialFixture } from '../utils/session/enrolment-credential-fixture';
import {
  bootEnrolmentApp,
  ENROLMENT_CREDENTIAL_ID,
  ENROLMENT_RP_ID,
  issueEnrolment,
  promoteEnrolment,
  sessionRevocations,
} from '../utils/session/enrolment-fixtures';

const MINUTE_MS = 60_000;
const DEADLINE = new Date('2099-01-01T12:15:00.000Z');
const INVALID_ENROLMENT = { code: 'PASSKEY_CHALLENGE_INVALID' };

// Failure: restricted authority or credential writes escape their deadline or transaction.
describe('enrolment promotion on the real database', () => {
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

  it.each([6, 14])(
    'promotes at minute %i with a new full credential and verified evidence',
    async (minutes) => {
      const issued = await issueEnrolment(e2e);
      expect(issued.session).toMatchObject({
        credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT,
        expiresAt: DEADLINE,
        idleExpiresAt: DEADLINE,
        authenticationMethods: [],
        userVerified: false,
      });
      expect(
        await e2e.app.get(Sessions).validateSession(issued.sessionToken),
      ).toBeNull();
      e2e.clock.advance(minutes * MINUTE_MS);
      const validator = e2e.app.get(SessionValidator);
      expect(
        (await validator.validateByToken(issued.sessionToken, true, true))
          ?.session.expiresAt,
      ).toEqual(DEADLINE);
      const receipt = await promoteEnrolment(e2e, issued);
      expect(receipt?.clientId).toBe(WEB_CLIENT_ID);
      if (!receipt) throw new Error('Promotion returned no committed receipt');
      expect(receipt.sessionToken).not.toBe(issued.sessionToken);
      const full = await e2e.app
        .get(Sessions)
        .validateSession(receipt.sessionToken);
      expect(full).toMatchObject({
        userId: issued.userId,
        clientId: WEB_CLIENT_ID,
        credentialPurpose: CREDENTIAL_PURPOSE.BROWSER_SESSION,
        authenticationMethods: ['passkey'],
        userVerified: true,
        csrfToken: receipt.csrfToken,
      });
      expect(full?.id).not.toBe(issued.session.id);
      expect(
        await validator.validateByToken(issued.sessionToken, false, true),
      ).toBeNull();
      expect(
        await e2e.app
          .get(SessionAuthorityStore)
          .readCommittedSessionById(issued.session.id),
      ).toMatchObject({ isValid: false, revokedAt: e2e.clock.now() });
      expect(
        await (
          await enrolmentCredentialFixture(e2e.app)
        ).revocationReason(issued.session.id),
      ).toBe('enrolment_promoted');
      expect(await sessionRevocations(e2e, issued.userId)).toEqual([
        { sessionId: issued.session.id, reasonCode: 'enrolment_promoted' },
      ]);
      expect(
        await (await enrolmentCredentialFixture(e2e.app)).count(issued.userId),
      ).toBe(1);
      expect(
        await e2e.app.get(Sessions).getUserSessions(issued.userId),
      ).toHaveLength(1);
    },
  );

  it.each([15, 16])(
    'refuses promotion at minute %i and rolls the credential back',
    async (minutes) => {
      const issued = await issueEnrolment(e2e);
      e2e.clock.advance(minutes * MINUTE_MS);
      await expect(promoteEnrolment(e2e, issued)).rejects.toMatchObject(
        INVALID_ENROLMENT,
      );
      expect(
        await e2e.app
          .get(SessionValidator)
          .validateByToken(issued.sessionToken, false, true),
      ).toBeNull();
      expect(
        await (await enrolmentCredentialFixture(e2e.app)).count(issued.userId),
      ).toBe(0);
      expect(await e2e.state.sessions.countSessions()).toBe(1);
    },
  );

  it('rolls credential insertion, retirement and full issuance back together', async () => {
    const issued = await issueEnrolment(e2e);
    const abort = new Error('Abort after promotion before commit');
    await expect(promoteEnrolment(e2e, issued, { abort })).rejects.toBe(abort);
    expect(
      await (await enrolmentCredentialFixture(e2e.app)).count(issued.userId),
    ).toBe(0);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
    const sessions = e2e.app.get(Sessions);
    expect(await sessions.getUserSessions(issued.userId)).toEqual([]);
    expect(await sessions.validateSession(issued.sessionToken)).toBeNull();
    expect(
      await sessions.validateBrowserSession(issued.sessionToken),
    ).toMatchObject({
      id: issued.session.id,
      credentialPurpose: CREDENTIAL_PURPOSE.ENROLMENT,
      csrfToken: issued.csrfToken,
    });
  });

  it('refuses a deactivated account and rolls its credential insertion back', async () => {
    const issued = await issueEnrolment(e2e);
    await e2e.state.records.markAccountDeleted(issued.userId);
    await expect(promoteEnrolment(e2e, issued)).rejects.toMatchObject(
      INVALID_ENROLMENT,
    );
    expect(
      await (await enrolmentCredentialFixture(e2e.app)).count(issued.userId),
    ).toBe(0);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
    ).toBeNull();
  });

  it.each(['user', 'rp', 'credential', 'uv', 'session', 'client'] as const)(
    'refuses a mismatched %s binding without persistent writes',
    async (binding) => {
      const issued = await issueEnrolment(e2e);
      const otherId = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
      if (!otherId) throw new Error('Other fixture account is missing');
      const options = {
        proof: {
          userId: binding === 'user' ? otherId : issued.userId,
          rpId: binding === 'rp' ? 'other.example.test' : ENROLMENT_RP_ID,
          credentialId: binding === 'credential' ? '' : ENROLMENT_CREDENTIAL_ID,
          userVerified: binding !== 'uv',
        },
        sessionId: binding === 'session' ? otherId : issued.session.id,
        clientId: binding === 'client' ? ADMIN_CLIENT_ID : WEB_CLIENT_ID,
      };
      await expect(
        promoteEnrolment(e2e, issued, options),
      ).rejects.toMatchObject(INVALID_ENROLMENT);
      expect(
        await (await enrolmentCredentialFixture(e2e.app)).count(issued.userId),
      ).toBe(0);
      expect(await e2e.state.sessions.countSessions()).toBe(1);
      expect(
        await e2e.app.get(Sessions).validateBrowserSession(issued.sessionToken),
      ).toMatchObject({ id: issued.session.id });
    },
  );

  it('leaves an ordinary full session unchanged and produces no promotion receipt', async () => {
    const issued = await issueEnrolment(e2e);
    const full = await e2e.app
      .get(SessionIssuanceService)
      .createBrowserSession(
        issued.userId,
        'Ordinary browser/1',
        '127.0.0.1',
        WEB_CLIENT_ID,
        { authenticationMethods: ['passkey'], userVerified: true },
      );
    const sessions = e2e.app.get(Sessions);
    const before = await sessions.validateSession(full.sessionToken);
    if (!before) throw new Error('Full fixture session is invalid');
    const promotion = e2e.app.get(EnrolmentPromotion);
    const receipt = await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
      await promotion.promoteAfterFirstPasskey(work, {
        sessionId: before.id,
        userId: issued.userId,
        clientId: WEB_CLIENT_ID,
        proof: {
          userId: issued.userId,
          rpId: '',
          credentialId: '',
          userVerified: false,
        },
      });
      return promotion.takePromotedSessionIn(work);
    });
    expect(receipt).toBeUndefined();
    expect(await sessions.validateSession(full.sessionToken)).toEqual(before);
    expect(await e2e.state.sessions.countSessions()).toBe(2);
  });
});
