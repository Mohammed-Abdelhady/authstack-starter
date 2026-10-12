import { SEED_USER } from '../constants/seed-users';
import request from 'supertest';
import {
  applyTwoFactorEnv,
  totpCodeAt,
} from '../utils/auth/two-factor-enrolment';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  createNativeApplication,
  issueNativeGrantFor,
} from '../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { SessionRevoker } from '../../src/session/revocation/session-revoker';
import { SecondFactorStore } from '../../src/auth/two-factor/stores/second-factor.store';

describe('two-factor confirmation session revocation (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootE2eApp(0, { nativeEnabled: true });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    jest.useFakeTimers({
      now: TEST_NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the confirming browser and ends another browser in the same change', async () => {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    const other = await loginAs(e2e.httpServer, SEED_USER);
    const setup = await owner
      .post('/api/auth/2fa/setup')
      .send({ password: SEED_USER.password })
      .expect(200);
    const secret = (setup.body as { data: { secret: string } }).data.secret;

    const confirmed = await owner
      .post('/api/auth/2fa/confirm')
      .send({ code: totpCodeAt(secret, TEST_NOW) })
      .expect(200);
    expect(
      (confirmed.body as { data: { recoveryCodes: string[] } }).data
        .recoveryCodes,
    ).toHaveLength(10);
    await owner.get('/api/user/profile').expect(200);
    await other.get('/api/user/profile').expect(401);
  });

  it('keeps the confirming native bearer and ends another browser', async () => {
    await createNativeApplication(e2e);
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);
    const native = () => request(e2e.httpServer);
    const setup = await native()
      .post('/api/auth/2fa/setup')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .send({ password: SEED_USER.password })
      .expect(200);
    const secret = (setup.body as { data: { secret: string } }).data.secret;

    await native()
      .post('/api/auth/2fa/confirm')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .send({ code: totpCodeAt(secret, TEST_NOW) })
      .expect(200);
    await native()
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);
    await browser.get('/api/user/profile').expect(401);
  });

  it('rolls back enablement and session revocation when revocation fails after its writes', async () => {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    const other = await loginAs(e2e.httpServer, SEED_USER);
    const setup = await owner
      .post('/api/auth/2fa/setup')
      .send({ password: SEED_USER.password })
      .expect(200);
    const secret = (setup.body as { data: { secret: string } }).data.secret;
    const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    expect(userId).not.toBeNull();
    const revoker = e2e.app.get(SessionRevoker, { strict: false });
    const revoke = revoker.revokeAllOthersExceptSessionIn.bind(revoker);
    const fault = jest
      .spyOn(revoker, 'revokeAllOthersExceptSessionIn')
      .mockImplementationOnce(async (...args) => {
        await revoke(...args);
        throw new Error(
          'Injected revocation failure after transactional writes',
        );
      });
    try {
      await owner
        .post('/api/auth/2fa/confirm')
        .send({ code: totpCodeAt(secret, TEST_NOW) })
        .expect(500);
    } finally {
      fault.mockRestore();
    }

    const factors = e2e.app.get(SecondFactorStore, { strict: false });
    const persisted = await factors.findAccount(userId ?? '');
    expect(persisted?.twoFactor.enabled).toBe(false);
    expect(persisted?.twoFactor.recoveryCodes).toEqual([]);
    await owner.get('/api/user/profile').expect(200);
    await other.get('/api/user/profile').expect(200);

    jest.setSystemTime(new Date(TEST_NOW.getTime() + 30_000));
    await owner
      .post('/api/auth/2fa/confirm')
      .send({ code: totpCodeAt(secret, new Date(Date.now())) })
      .expect(200);
    await other.get('/api/user/profile').expect(401);
  });

  it('hands recovery codes to only one of two simultaneous confirmations', async () => {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    const setup = await owner
      .post('/api/auth/2fa/setup')
      .send({ password: SEED_USER.password })
      .expect(200);
    const secret = (setup.body as { data: { secret: string } }).data.secret;
    const code = totpCodeAt(secret, TEST_NOW);

    const answers = await Promise.all([
      owner.post('/api/auth/2fa/confirm').send({ code }),
      owner.post('/api/auth/2fa/confirm').send({ code }),
    ]);
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
    expect(answers.filter((answer) => answer.status >= 400)).toHaveLength(1);
    await owner.get('/api/user/profile').expect(200);
  });

  it('mails the verified address after two-factor is disabled', async () => {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    const setup = await owner
      .post('/api/auth/2fa/setup')
      .send({ password: SEED_USER.password })
      .expect(200);
    const secret = (setup.body as { data: { secret: string } }).data.secret;
    await owner
      .post('/api/auth/2fa/confirm')
      .send({ code: totpCodeAt(secret, TEST_NOW) })
      .expect(200);
    jest.setSystemTime(new Date(TEST_NOW.getTime() + 30_000));
    await owner
      .post('/api/auth/2fa/disable')
      .send({
        password: SEED_USER.password,
        code: totpCodeAt(secret, new Date(Date.now())),
      })
      .expect(200);
    const notices = await e2e.captureMail();
    expect(notices).toMatchObject([
      {
        to: SEED_USER.email,
        subject: 'Two-factor authentication was disabled',
      },
    ]);
  });
});
