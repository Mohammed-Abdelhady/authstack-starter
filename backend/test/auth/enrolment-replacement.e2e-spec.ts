// feature:passkeys:start
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import {
  ADMIN_CLIENT_ID,
  WEB_CLIENT_ID,
} from '../../src/session/constants/client-ids';
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
  issueEnrolment,
  sessionRevocations,
} from '../utils/session/enrolment-fixtures';

describe('enrolment replacement', () => {
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

  // Failure: repeated invitation/reset completion accumulates limited authority.
  it('replaces only earlier enrolments for the same account and application', async () => {
    const first = await issueEnrolment(e2e);
    const issuer = e2e.app.get(SessionIssuanceService);
    const runner = e2e.app.get(UnitOfWorkRunner);
    const full = await issuer.createBrowserSession(
      first.userId,
      'Full authority/1',
      '127.0.0.1',
      WEB_CLIENT_ID,
      { authenticationMethods: ['passkey'], userVerified: true },
    );
    const otherId = await e2e.state.accounts.accountIdFor(SEED_ADMIN.email);
    if (!otherId) throw new Error('Other fixture account is missing');
    const otherUser = await runner.run((work) =>
      issuer.createEnrolmentSessionIn(
        work,
        otherId,
        'Other user/1',
        '127.0.0.1',
        WEB_CLIENT_ID,
      ),
    );
    const otherClient = await runner.run((work) =>
      issuer.createEnrolmentSessionIn(
        work,
        first.userId,
        'Other application/1',
        '127.0.0.1',
        ADMIN_CLIENT_ID,
      ),
    );
    const second = await issueEnrolment(e2e);
    const sessions = e2e.app.get(Sessions);
    expect(
      await sessions.validateBrowserSession(first.sessionToken),
    ).toBeNull();
    expect(
      await sessions.validateBrowserSession(second.sessionToken),
    ).toMatchObject({ id: second.session.id });
    expect(await sessions.validateSession(full.sessionToken)).not.toBeNull();
    expect(
      await sessions.validateBrowserSession(otherUser.sessionToken),
    ).not.toBeNull();
    expect(
      await sessions.validateBrowserSession(otherClient.sessionToken),
    ).not.toBeNull();
    expect(
      await (
        await enrolmentCredentialFixture(e2e.app)
      ).revocationReason(first.session.id),
    ).toBe('enrolment_replaced');
    expect(await sessionRevocations(e2e, first.userId)).toEqual([
      { sessionId: first.session.id, reasonCode: 'enrolment_replaced' },
    ]);
  });

  // Failure: a failed replacement retires the old token without issuing a new one.
  it('rolls replacement retirement back with the issuing unit of work', async () => {
    const first = await issueEnrolment(e2e);
    const abort = new Error('Abort enrolment replacement');
    await expect(
      e2e.app.get(UnitOfWorkRunner).run(async (work) => {
        await e2e.app
          .get(SessionIssuanceService)
          .createEnrolmentSessionIn(
            work,
            first.userId,
            'Failed replacement/1',
            '127.0.0.1',
            WEB_CLIENT_ID,
          );
        throw abort;
      }),
    ).rejects.toBe(abort);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
    expect(
      await e2e.app.get(Sessions).validateBrowserSession(first.sessionToken),
    ).toMatchObject({ id: first.session.id });
    expect(
      await (
        await enrolmentCredentialFixture(e2e.app)
      ).revocationReason(first.session.id),
    ).toBeNull();
    expect(await sessionRevocations(e2e, first.userId)).toEqual([]);
  });
});
// feature:passkeys:end
