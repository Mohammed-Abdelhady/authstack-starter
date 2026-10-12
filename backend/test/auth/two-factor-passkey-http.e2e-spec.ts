import {
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
  assertionCredential,
  createSoftwareAuthenticator,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  answerSecondStep,
  applyTwoFactorEnv,
  enrolTwoFactor,
  passwordFirstStep,
} from '../utils/auth/two-factor-enrolment';
import {
  bootE2eApp,
  E2E_CLIENT_URL,
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const STEP = new Date('2099-01-01T12:00:00.000Z');

describe('passkey answer to a held two-step sign-in (e2e)', () => {
  let e2e: E2eApp;
  let restoreEnv: () => void;

  beforeAll(async () => {
    restoreEnv = applyTwoFactorEnv();
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
    restoreEnv();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    await e2e.state.auth.removeEveryPasskey();
    jest.useFakeTimers({
      now: STEP,
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

  async function heldAnswer(flags: number, keyOwner = SEED_USER.email) {
    const owner = await loginAs(e2e.httpServer, SEED_USER);
    await enrolTwoFactor(owner, SEED_USER.password, STEP);
    const authenticator = createSoftwareAuthenticator(
      Buffer.from('second-factor-http-key'),
    );
    await e2e.state.auth.storePasskey(keyOwner, {
      credentialId: authenticator.credentialId,
      publicKey: authenticator.cosePublicKey,
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'Security key',
      lastUsedAt: null,
    });
    const { agent, response } = await passwordFirstStep(
      e2e.httpServer,
      SEED_USER,
    );
    expect(response.status).toBe(200);
    const browserProof = await agent.get('/api/auth/browser-proof').expect(200);
    const token = (browserProof.body as { data: { token: string } }).data.token;
    const options = await agent
      .post('/api/auth/passkeys/login/options')
      .set(CSRF_HEADER, token)
      .send({})
      .expect(200);
    const data = options.body as {
      data: { challenge: string; rpId: string };
    };
    const credential = assertionCredential(authenticator, {
      challenge: data.data.challenge,
      rpId: data.data.rpId,
      origin: E2E_CLIENT_URL,
      flags,
      counter: 1,
    });
    const answer = await answerSecondStep(agent, {
      passkeyResponse: credential,
    });
    return { agent, answer };
  }

  it('finishes the password challenge with a user-verified passkey', async () => {
    const { agent, answer } = await heldAnswer(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
    );
    expect(answer.status).toBe(200);
    const cookieName = e2e.app.get(SessionCookieService, {
      strict: false,
    }).name;
    expect(answer.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(new RegExp(`^${cookieName}=`)),
      ]),
    );
    await agent.get('/api/user/profile').expect(200);
  });

  it('refuses another account’s passkey', async () => {
    const { agent, answer } = await heldAnswer(
      FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      SEED_ADMIN.email,
    );
    expect(answer.status).toBe(401);
    expect((answer.body as { error: { code: string } }).error.code).toBe(
      ErrorCode.PASSKEY_VERIFICATION_FAILED,
    );
    await agent.get('/api/user/profile').expect(401);
  });
});
