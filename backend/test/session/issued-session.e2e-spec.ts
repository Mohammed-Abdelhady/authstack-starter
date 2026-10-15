import request from 'supertest';
import { browserApplicationCases } from '../utils/browser-applications.cases'; // feature:email-password
import { browserApplicationPolicyCases } from '../utils/browser-applications-policy.cases'; // feature:email-password
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  loginAs, // feature:email-password
  type E2eApp,
} from '../utils/e2e-app';
import { issuedSession } from '../utils/e2e-sign-in';
import { TEST_NOW } from '../utils/frozen-clock';

interface ProfileBody {
  data: { email: string; name: string; role: string; permissions: string[] };
}

interface ApiErrorBody {
  error: { code: string };
}

/**
 * The session a case gets without a sign-in route. Every project carries it,
 * and a project without password sign-in gets every signed-in agent this way.
 */
describe('a session issued for a stored account (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  });

  afterAll(async () => {
    await e2e?.close();
  });

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  it('reads the profile of the account it was issued for and of no other', async () => {
    const user = await issuedSession(e2e.httpServer, SEED_USER);
    const admin = await issuedSession(e2e.httpServer, SEED_ADMIN);

    const asUser = await user.get('/api/user/profile').expect(200);
    const asAdmin = await admin.get('/api/user/profile').expect(200);

    expect({
      user: (asUser.body as ProfileBody).data.email,
      admin: (asAdmin.body as ProfileBody).data.email,
      sessions: await e2e.state.sessions.countSessions(),
    }).toEqual({
      user: 'user@seed.local',
      admin: 'admin@seed.local',
      sessions: 2,
    });
  });

  it('carries the browser proof a write needs, and its cookie alone does not', async () => {
    const user = await issuedSession(e2e.httpServer, SEED_USER);
    const cookies = user.jar.getCookies({
      domain: '127.0.0.1',
      path: '/',
      secure: false,
      script: false,
    });

    const withoutProof = await request(e2e.httpServer)
      .patch('/api/user/profile')
      .set('Cookie', cookies.toValueString())
      .send({ name: 'Never Stored' });
    const withProof = await user
      .patch('/api/user/profile')
      .send({ name: 'Stored Name' });

    expect({
      withoutProof: [
        withoutProof.status,
        (withoutProof.body as ApiErrorBody).error.code,
      ],
      withProof: withProof.status,
      stored: (await e2e.state.accounts.accountWithAddress(SEED_USER.email))
        ?.name,
    }).toEqual({
      withoutProof: [403, ErrorCode.CSRF_REQUIRED],
      withProof: 200,
      stored: 'Stored Name',
    });
  });

  it('ends when it is signed out', async () => {
    const user = await issuedSession(e2e.httpServer, SEED_USER);

    await user.post('/api/auth/logout').expect(200);

    await user.get('/api/user/profile').expect(401);
  });

  it('refuses an address no account is stored for', async () => {
    await expect(
      issuedSession(e2e.httpServer, { email: 'nobody@example.test' }),
    ).rejects.toThrow('no account is stored for nobody@example.test');
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  // feature:email-password:start
  it('is the account the password login route signs in, with the same role and permissions', async () => {
    const issued = await issuedSession(e2e.httpServer, SEED_ADMIN);
    const signedIn = await loginAs(e2e.httpServer, SEED_ADMIN);

    const fromIssued = await issued.get('/api/user/profile').expect(200);
    const fromLogin = await signedIn.get('/api/user/profile').expect(200);

    expect((fromIssued.body as ProfileBody).data).toEqual(
      (fromLogin.body as ProfileBody).data,
    );
    expect((fromLogin.body as ProfileBody).data.email).toBe('admin@seed.local');
  });

  it('is not what loginAs uses here: loginAs signs in through the password route', async () => {
    // The password route refuses a wrong password. An issued session never asks for one.
    await expect(
      loginAs(e2e.httpServer, { ...SEED_USER, password: 'Not-the-password-1' }),
    ).rejects.toThrow();
    expect(await e2e.state.sessions.countSessions()).toBe(0);

    await loginAs(e2e.httpServer, SEED_USER);
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });
  // feature:email-password:end
});

browserApplicationCases(); // feature:email-password
browserApplicationPolicyCases(); // feature:email-password
