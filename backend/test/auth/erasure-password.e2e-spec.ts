import type { TestAgent } from '../utils/e2e-app';
import { cookieClient } from '../utils/sdk/sdk-transport';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work'; // feature:oauth-core
import { AccountProfileStore } from '../../src/user/stores/account-profile.store'; // feature:oauth-core
import { OAuthService } from '../../src/auth/oauth/oauth.service'; // feature:oauth-core
import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request, { type Response } from 'supertest';
import { DEFAULT_API_AUDIENCE } from '../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const ERASE_AFTER = '2099-01-31T12:00:00.000Z';

describe('erasure refusal after password verification', () => {
  let e2e: E2eApp;
  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      beforeStart: (app) => {
        const config = app.get(ConfigService);
        config.set('account.eraseGraceDays', 30);
        config.set('auth.nativeEnabled', true);
        config.set('auth.nativeApplications', [
          {
            clientId: NATIVE_CLIENT_ID,
            displayName: 'Erasure fixture',
            redirectUris: [NATIVE_REDIRECT],
            allowedScopes: [DEFAULT_API_AUDIENCE],
            signIn: { password: true },
          },
        ]);
      },
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });
  async function deleteWithProof(browser: TestAgent): Promise<Response> {
    const client = cookieClient(browser);
    await client.proof.sendCode();
    await client.proof.verifyCode({ code: await e2e.mailedCode() });
    return browser.delete('/api/user/account').send({}).expect(200);
  }

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function nativeAttempt() {
    const query = nativeAuthorizeQuery(randomBytes(32).toString('base64url'));
    const answer = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId: NATIVE_CLIENT_ID,
        redirectUri: NATIVE_REDIRECT,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'signIn',
      })
      .expect(201);
    return (
      answer.body as { data: { attemptId: string; attemptSecret: string } }
    ).data;
  }

  // feature:oauth-core:start
  it('requires provider account binding before revealing erasure', async () => {
    const oauth = e2e.app.get(OAuthService);
    const profile = {
      providerId: 'bound-provider',
      email: SEED_USER.email,
      name: 'Owner',
      emailVerified: true,
    };
    await expect(
      oauth.findOrCreateUser(
        { id: 'facebook', autoLinksByEmail: false },
        profile,
      ),
    ).rejects.toMatchObject({
      code: 'OAUTH_ACCOUNT_EXISTS',
      details: { provider: 'facebook' },
    });
    await oauth.findOrCreateUser(
      { id: 'google', autoLinksByEmail: true },
      profile,
    );
    const unverified = await e2e.state.accounts.createAccount({
      email: 'unverified@example.test',
      name: 'Unverified',
      isVerified: false,
    });
    const unverifiedProfile = {
      ...profile,
      providerId: 'unbound-unverified',
      email: 'unverified@example.test',
    };
    await expect(
      oauth.findOrCreateUser(
        { id: 'google', autoLinksByEmail: true },
        unverifiedProfile,
      ),
    ).rejects.toMatchObject({
      code: 'OAUTH_ACCOUNT_EXISTS',
      details: { provider: 'google' },
    });
    await e2e.app.get(UnitOfWorkRunner).run(async (work) => {
      const store = e2e.app.get(AccountProfileStore);
      const account = await store.readAccount(work, unverified._id);
      if (!account) throw new Error('Missing account');
      await store.saveDeactivation(work, account, e2e.clock.now());
    });
    await expect(
      oauth.findOrCreateUser(
        { id: 'google', autoLinksByEmail: true },
        unverifiedProfile,
      ),
    ).rejects.toMatchObject({
      code: 'OAUTH_ACCOUNT_EXISTS',
      details: { provider: 'google' },
    });
    const signedIn = await loginAs(e2e.httpServer, SEED_USER);
    await deleteWithProof(signedIn);
    const sessions = await e2e.state.sessions.countSessions();
    await expect(
      oauth.findOrCreateUser(
        { id: 'facebook', autoLinksByEmail: false },
        profile,
      ),
    ).rejects.toMatchObject({
      code: 'OAUTH_ACCOUNT_EXISTS',
      details: { provider: 'facebook' },
    });
    for (const providerId of ['bound-provider', 'another-verified-provider']) {
      await expect(
        oauth.findOrCreateUser(
          { id: 'google', autoLinksByEmail: true },
          { ...profile, providerId },
        ),
      ).rejects.toMatchObject({
        code: 'ACCOUNT_ERASURE_PENDING',
        details: { eraseAfter: ERASE_AFTER },
      });
    }
    expect(await e2e.state.sessions.countSessions()).toBe(sessions);
  });
  // feature:oauth-core:end

  it('reveals the committed date only after correct browser or native credentials', async () => {
    const correct = await nativeAttempt();
    const wrong = await nativeAttempt();
    const signedIn = await loginAs(e2e.httpServer, SEED_USER);
    const deleted = await deleteWithProof(signedIn);
    expect(deleted.body).toMatchObject({ data: { eraseAfter: ERASE_AFTER } });
    const sessions = await e2e.state.sessions.countSessions();
    const browser = await browserAgent(e2e.httpServer);
    const invalid = await browser
      .post('/api/auth/login')
      .send({ email: SEED_USER.email, password: 'Incorrect123!' })
      .expect(401);
    expect(invalid.body).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS' },
    });
    expect(
      (invalid.body as { error: { details?: unknown } }).error.details,
    ).toBeUndefined();
    const correctBrowser = await browserAgent(e2e.httpServer);
    const valid = await correctBrowser
      .post('/api/auth/login')
      .send(SEED_USER)
      .expect(403);
    expect(valid.body).toMatchObject({
      error: {
        code: 'ACCOUNT_ERASURE_PENDING',
        details: { eraseAfter: ERASE_AFTER },
      },
    });
    const attempt = (input: typeof correct, password: string) =>
      request(e2e.httpServer)
        .post(`/api/auth/native/attempts/${input.attemptId}/password`)
        .set('X-Native-Attempt', input.attemptSecret)
        .send({ email: SEED_USER.email, password });
    const invalidNative = await attempt(wrong, 'Incorrect123!').expect(401);
    expect(invalidNative.body).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS' },
    });
    expect(
      (invalidNative.body as { error: { details?: unknown } }).error.details,
    ).toBeUndefined();
    expect(
      (await attempt(correct, SEED_USER.password).expect(403)).body,
    ).toMatchObject({
      error: {
        code: 'ACCOUNT_ERASURE_PENDING',
        details: { eraseAfter: ERASE_AFTER },
      },
    });
    expect(await e2e.state.sessions.countSessions()).toBe(sessions);
  });
});
