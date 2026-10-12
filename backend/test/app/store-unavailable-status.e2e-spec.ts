import { AdminAccountStore } from '../../src/admin/stores/admin-account.store';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { PasswordSignInStore } from '../../src/auth/stores/password-sign-in.store'; // feature:email-password
import { PersistenceUnavailableError } from '../../src/common/persistence/persistence-errors';
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

/**
 * The status a client gets while the store is unavailable. The session
 * authority and activation answer 503 for the same outage, so a client can
 * tell "try again later" from a fault in the server.
 */
function away(): PersistenceUnavailableError {
  return new PersistenceUnavailableError(new Error('connection refused'));
}

describe('the status of a request while the store is unavailable (e2e)', () => {
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

  it('answers the session list with 503', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    jest
      .spyOn(e2e.app.get(Sessions, { strict: false }), 'getUserSessions')
      .mockRejectedValue(away());

    const answered = await browser.get('/api/user/sessions');

    expect(answered.status).toBe(503);
  });

  it('answers an administrator creating a user with 503', async () => {
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    jest
      .spyOn(
        e2e.app.get(AdminAccountStore, { strict: false }),
        'isAddressTaken',
      )
      .mockRejectedValue(away());

    const answered = await admin.post('/api/admin/users').send({
      email: 'created@seed.local',
      name: 'Created User',
      password: 'Created123!',
      role: 'user',
    });

    expect(answered.status).toBe(503);
  });

  // feature:email-password:start
  it('answers a password sign-in with 503', async () => {
    jest
      .spyOn(
        e2e.app.get(PasswordSignInStore, { strict: false }),
        'findForPasswordCheck',
      )
      .mockRejectedValue(away());
    const agent = await browserAgent(e2e.httpServer);

    const answered = await agent
      .post('/api/auth/login')
      .send({ email: SEED_USER.email, password: SEED_USER.password });

    expect(answered.status).toBe(503);
  });
  // feature:email-password:end
});
