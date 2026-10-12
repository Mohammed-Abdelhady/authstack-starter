import type { Response } from 'supertest';
import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { PasswordSignInStore } from '../../src/auth/stores/password-sign-in.store'; // feature:email-password
import { PersistenceUnavailableError } from '../../src/common/persistence/persistence-errors';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent, // feature:email-password
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { refusalAnswer } from '../utils/route-id-answers';

const DRIVER_TEXT = 'connect ECONNREFUSED 10.0.0.9:5432';

/** What a store raises while its database is away, as the outage specs prove. */
function away(): PersistenceUnavailableError {
  return new PersistenceUnavailableError(new Error(DRIVER_TEXT));
}

describe('a request while the store is unavailable (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A server failure in the shared envelope, with nothing of the driver in it. */
  function expectOutageAnswer(response: Response): void {
    const answer = refusalAnswer(response);
    expect(answer.status).toBe(503);
    expect(answer).toMatchObject({
      success: false,
      bodyKeys: ['error', 'requestId', 'success'],
      errorKeys: ['code', 'message'],
      code: ErrorCode.INTERNAL_ERROR,
    });
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(response.body)).not.toContain('10.0.0.9');
  }

  it('answers the session list as a server failure, then serves it again', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    jest
      .spyOn(e2e.app.get(Sessions, { strict: false }), 'getUserSessions')
      .mockRejectedValue(away());

    expectOutageAnswer(await browser.get('/api/user/sessions'));

    jest.restoreAllMocks();
    await browser.get('/api/user/sessions').expect(200);
  });

  it('answers an administrator creating a user as a server failure, and stores nothing', async () => {
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    jest
      .spyOn(
        e2e.app.get(AdminAccountStore, { strict: false }),
        'isAddressTaken',
      )
      .mockRejectedValue(away());

    expectOutageAnswer(
      await admin.post('/api/admin/users').send({
        email: 'created@seed.local',
        name: 'Created User',
        password: 'Created123!',
        role: 'user',
      }),
    );

    expect(
      await e2e.state.accounts.accountWithAddress('created@seed.local'),
    ).toBeNull();
  });

  // feature:email-password:start
  it('answers a password sign-in as a server failure, with no session', async () => {
    jest
      .spyOn(
        e2e.app.get(PasswordSignInStore, { strict: false }),
        'findForPasswordCheck',
      )
      .mockRejectedValue(away());

    const agent = await browserAgent(e2e.httpServer);
    const response = await agent
      .post('/api/auth/login')
      .send({ email: SEED_USER.email, password: SEED_USER.password });

    expectOutageAnswer(response);
    await agent.get('/api/user/profile').expect(401);
  });
  // feature:email-password:end
});
