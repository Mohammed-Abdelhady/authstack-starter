import { publicClient } from '../utils/sdk/sdk-transport';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { ApplicationRegistry } from '../../src/session/applications/application-registry';
import {
  SEED_ADMIN,
  SEED_USER, // feature:totp
} from '../constants/seed-users';
import {
  bootE2eApp,
  E2E_CLIENT_URL,
  loginAs, // feature:totp
  type E2eApp,
} from '../utils/e2e-app';
import {
  ADMIN_ORIGIN,
  arrangeAudiences,
} from '../utils/audience-authorization.fixtures';
import {
  anonymousPost,
  expectNoAuthority,
} from '../utils/auth/audience-refusal.fixtures';
import { PROVIDER_ID } from '../utils/auth/audience-provider.fixture';
import { RaceGate } from '../utils/race-gate';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import {
  HeldPolicyProvider,
  PROVIDER_START,
  finishPolicyProvider,
  setProviderPolicy,
  startPolicyProvider,
} from './browser-provider-policy.fixture';

// feature:totp:start
import {
  applyTwoFactorEnv,
  enrolTwoFactor,
  answerSecondStep,
  totpCodeAt,
} from '../utils/auth/two-factor-enrolment';
// feature:totp:end

const NATIVE_CLIENT = 'provider-policy-native';

describe('browser provider policy across real application and session stores', () => {
  let e2e: E2eApp;
  const provider = new HeldPolicyProvider();
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      browserStrategy: provider,
      nativeEnabled: true,
      nativeApplications: [
        {
          clientId: NATIVE_CLIENT,
          displayName: 'Provider policy',
          redirectUris: ['https://policy.example.test/callback'],
          allowedScopes: ['api'],
          signIn: {
            providers: [
              {
                id: PROVIDER_ID,
                mode: 'googleIdentityToken',
                webClientId: 'external-test-client',
              },
            ],
          },
        },
      ],
      beforeStart: (app) =>
        app.get(ConfigService).set('cors.adminUrl', ADMIN_ORIGIN),
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    provider.gate = undefined;
    provider.exchanges = 0;
    provider.email = SEED_ADMIN.email;
    e2e.clock.set(TEST_NOW);
    await arrangeAudiences(e2e);
    await e2e.state.auth.linkProviderAccounts(SEED_ADMIN.email, [
      {
        provider: provider.id,
        providerId: `provider:${SEED_ADMIN.email}`,
        linkedAt: TEST_NOW,
      },
    ]);
  });

  it('filters browser metadata and POST start while native and the other browser stay enabled', async () => {
    await setProviderPolicy(e2e, false);
    const methods = await request(e2e.httpServer)
      .get('/api/auth/methods')
      .set('Origin', ADMIN_ORIGIN)
      .expect(200);
    expect(methods.body.data.methods.oauth).toEqual([]);
    const providers = await request(e2e.httpServer)
      .get('/api/auth/oauth/providers')
      .set('Origin', ADMIN_ORIGIN)
      .expect(200);
    expect(providers.body.data.providers).toEqual([]);
    const refused = await anonymousPost(e2e, PROVIDER_START, {});
    expect(refused.status).toBe(404);
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    const other = await request(e2e.httpServer)
      .get('/api/auth/methods')
      .set('Origin', E2E_CLIENT_URL)
      .expect(200);
    expect(other.body.data.methods.oauth).toMatchObject([{ id: 'google' }]);
    const native = await publicClient(e2e).nativeAuth.methods(NATIVE_CLIENT);
    expect(native.nativeEnabled).toBe(true);
    expect(native.providers).toMatchObject([{ id: PROVIDER_ID }]);
    expect(native.methods.oauth).toMatchObject([{ id: PROVIDER_ID }]);
    const machine = await request(e2e.httpServer)
      .get('/api/auth/oauth/providers')
      .expect(200);
    expect(machine.body.data.providers).toMatchObject([{ id: PROVIDER_ID }]);
  });

  it('refuses an allowed pending ceremony after the application is tightened', async () => {
    const ceremony = await startPolicyProvider(e2e, provider);
    await setProviderPolicy(e2e, false);
    const refused = await finishPolicyProvider(ceremony);
    expect(provider.exchanges).toBe(0);
    expect(
      new URL(String(refused.headers.location)).searchParams.get('status'),
    ).toBe('error');
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(0); // feature:totp
  });

  it('checks persisted authority after runtime admission and external provider work', async () => {
    const gate = new RaceGate();
    provider.gate = gate;
    const ceremony = await startPolicyProvider(e2e, provider);
    const completing = finishPolicyProvider(ceremony);
    try {
      await gate.reached();
      await setProviderPolicy(e2e, false);
      e2e.app.get(ConfigService).set('auth.admin.signIn', {
        audience: 'staff',
        signUp: 'closed',
        oauth: true,
      });
      expect(
        await e2e.app.get(ApplicationRegistry).findByClientId('admin'),
      ).toMatchObject({ signInMethods: { oauth: false } });
    } finally {
      gate.release();
      await Promise.allSettled([completing]);
    }
    const refused = await completing;
    expect(
      new URL(String(refused.headers.location)).searchParams.get('status'),
    ).toBe('error');
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(0); // feature:totp
  });
  it('refuses new browser account creation inside the persisted provider policy transaction', async () => {
    const email = 'uncreated-provider@policy.example.test';
    provider.email = email;
    const gate = new RaceGate();
    provider.gate = gate;
    const ceremony = await startPolicyProvider(e2e, provider, {
      origin: E2E_CLIENT_URL,
      clientId: 'web',
    });
    const completing = finishPolicyProvider(ceremony);
    try {
      await gate.reached();
      const config = e2e.app.get(ConfigService);
      config.set('auth.web.signIn', { oauth: false });
      await reconcileStartupApplications(e2e.app);
      config.set('auth.web.signIn', { oauth: true });
    } finally {
      gate.release();
      await Promise.allSettled([completing]);
    }
    const refused = await completing;
    expect(
      new URL(String(refused.headers.location)).searchParams.get('status'),
    ).toBe('error');
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.auth.countAccountsWithAddress(email)).toBe(0);
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });
});

// feature:totp:start
describe('provider-origin second factor keeps the browser policy version', () => {
  let e2e: E2eApp;
  let restore: () => void;
  const provider = new HeldPolicyProvider();
  beforeAll(async () => {
    restore = applyTwoFactorEnv();
    e2e = await bootE2eApp(0, { browserStrategy: provider });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    try {
      await e2e?.close();
    } finally {
      restore();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  afterEach(() => jest.useRealTimers());

  it('refuses a valid TOTP answer after provider sign-in is disabled', async () => {
    jest.useFakeTimers({
      now: TEST_NOW,
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
        'queueMicrotask',
      ],
    });
    provider.email = SEED_USER.email;
    const enrolled = await loginAs(e2e.httpServer, SEED_USER);
    const setup = await enrolTwoFactor(enrolled, SEED_USER.password, TEST_NOW);
    await e2e.state.auth.linkProviderAccounts(SEED_USER.email, [
      {
        provider: provider.id,
        providerId: `provider:${SEED_USER.email}`,
        linkedAt: TEST_NOW,
      },
    ]);
    const initialSessions = await e2e.state.sessions.countSessions();
    const ceremony = await startPolicyProvider(e2e, provider, {
      origin: E2E_CLIENT_URL,
      clientId: 'web',
    });
    const first = await finishPolicyProvider(ceremony);
    expect(first.status).toBe(302);
    expect(await e2e.state.auth.countSecondFactorChallenges()).toBe(1);
    expect(await e2e.state.sessions.countSessions()).toBe(initialSessions);
    e2e.app.get(ConfigService).set('auth.web.signIn', { oauth: false });
    await reconcileStartupApplications(e2e.app);
    const next = new Date(TEST_NOW.getTime() + 30000);
    jest.setSystemTime(next);
    const refused = await answerSecondStep(ceremony.browser, {
      code: totpCodeAt(setup.secret, next),
    });
    expect(refused.status).toBe(401);
    expectNoAuthority(e2e, refused);
    expect(await e2e.state.sessions.countSessions()).toBe(initialSessions);
  });
});
// feature:totp:end
