import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { SEED_USER } from '../constants/seed-users';
import { bootE2eApp, browserAgent, type E2eApp } from '../utils/e2e-app';
import { issuedSession } from '../utils/e2e-sign-in';
import { TEST_NOW } from '../utils/frozen-clock';

interface Answer {
  status: number;
  code: string;
}

const NOT_OFFERED: Answer = { status: 404, code: ErrorCode.FEATURE_DISABLED };

/**
 * Every route of email and password sign-in answers as if it were not there
 * once the method is off. In a project that left the method out it is always
 * off, so the same answers hold there with nothing switched.
 */
describe('the routes of password sign-in while the method is off (e2e)', () => {
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
    e2e.app.get(ConfigService).set('auth.passwordEnabled', false);
  });

  const answerOf = (response: {
    status: number;
    body: { error?: { code?: string } };
  }): Answer => ({
    status: response.status,
    code: response.body.error?.code ?? 'none',
  });

  it('answers each public route as not offered, and stores and mails nothing', async () => {
    const email = 'gated@example.test';
    const sent: Record<string, Answer> = {};
    const bodies: Record<string, object> = {
      register: { email },
      activate: {
        email,
        code: '123456',
        password: 'Gated-Pass-1',
        name: 'Gated',
      },
      'resend-activation': { email },
      login: { email: SEED_USER.email, password: SEED_USER.password },
      'forgot-password': { email: SEED_USER.email },
      'reset-password': {
        email: SEED_USER.email,
        code: '123456',
        password: 'Gated-Pass-1',
      },
    };

    for (const [route, body] of Object.entries(bodies)) {
      // A proof before sign-in is spent by the request that presents it.
      const browser = await browserAgent(e2e.httpServer);
      sent[route] = answerOf(
        await browser.post(`/api/auth/${route}`).send(body),
      );
    }

    expect({
      sent,
      mail: (await e2e.captureMail()).length,
      pending: await e2e.state.auth.countPendingRegistrations(email),
      sessions: await e2e.state.sessions.countSessions(),
    }).toEqual({
      sent: {
        register: NOT_OFFERED,
        activate: NOT_OFFERED,
        'resend-activation': NOT_OFFERED,
        login: NOT_OFFERED,
        'forgot-password': NOT_OFFERED,
        'reset-password': NOT_OFFERED,
      },
      mail: 0,
      pending: 0,
      sessions: 0,
    });
  });

  it('answers a password change as not offered to a signed-in account, and keeps its password', async () => {
    const before = (
      await e2e.state.accounts.accountWithAddress(SEED_USER.email)
    )?.password;
    const signedIn = await issuedSession(e2e.httpServer, SEED_USER);

    const changed = await signedIn.post('/api/user/password').send({
      currentPassword: SEED_USER.password,
      newPassword: 'Gated-Pass-2',
    });
    const signedOut = await (
      await browserAgent(e2e.httpServer)
    )
      .post('/api/user/password')
      .send({
        currentPassword: SEED_USER.password,
        newPassword: 'Gated-Pass-2',
      });

    expect({
      changed: answerOf(changed),
      // The session guard runs first, so a caller without a session learns nothing.
      signedOut: signedOut.status,
      stored:
        (await e2e.state.accounts.accountWithAddress(SEED_USER.email))
          ?.password === before,
      hadPassword: typeof before === 'string' && before.length > 0,
    }).toEqual({
      changed: NOT_OFFERED,
      signedOut: 401,
      stored: true,
      hadPassword: true,
    });
  });
});
