import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { AccountSessions } from '../../../src/user/stores/account-sessions';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { NativeAttemptService } from '../../../src/auth/native/services/native-attempt.service';
import { NativeTokenService } from '../../../src/session/native/token/native-token.service';
import { AccountProfileStore } from '../../../src/user/stores/account-profile.store';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';

const APPLICATION = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native test client',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  signIn: { password: true },
};

describe('native attempt foundation (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: [APPLICATION],
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeApplications', [APPLICATION]);
    await e2e.reset();
  });

  async function start() {
    const verifier = randomBytes(32).toString('base64url');
    const query = nativeAuthorizeQuery(verifier);
    const response = await request(e2e.httpServer)
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
    const attempt = unwrapNativeAttemptStart({
      status: response.status,
      body: response.body,
    });
    return { attempt, verifier };
  }

  async function principal() {
    const id = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!id) throw new Error('seed user missing');
    const account = await e2e.app.get(AccountProfileStore).findProfile(id);
    if (!account) throw new Error('seed user missing');
    return {
      userId: id,
      userVersion: account.sessionVersion,
      firstFactor: 'password' as const,
      authenticationMethods: ['password'],
    };
  }

  it('starts with an SDK parseable secret and resumes only for that secret', async () => {
    const { attempt } = await start();
    expect(attempt).toMatchObject({
      stage: 'firstFactorRequired',
      factors: ['password'],
    });
    expect(attempt.attemptSecret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const read = await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(200);
    expect(
      unwrapNativeAttemptResult({ status: read.status, body: read.body }),
    ).toMatchObject({ stage: 'firstFactorRequired', factors: ['password'] });
    await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set('X-Native-Attempt', 'x'.repeat(43))
      .expect(401);
  });

  it('rejects browser Origin and Cookie before start', async () => {
    const { attempt } = await start();
    await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .set('Origin', 'https://example.test')
      .expect(403);
    await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .set('Cookie', 'session=x')
      .expect(403);
  });

  it('rejects a first factor verified before the account version changed', async () => {
    const { attempt } = await start();
    const oldPrincipal = await principal();
    await e2e.app
      .get(UnitOfWorkRunner)
      .run((work) =>
        e2e.app.get(AccountSessions).revokeAll(work, oldPrincipal.userId),
      );
    await expect(
      e2e.app
        .get(NativeAttemptService)
        .completeFactor(attempt.attemptId, attempt.attemptSecret, oldPrincipal),
    ).rejects.toMatchObject({ status: 409 });
    const read = await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(200);
    expect((read.body as { data: { stage: string } }).data.stage).toBe(
      'firstFactorRequired',
    );
  });

  it('rejects policy changes before factor completion', async () => {
    const { attempt } = await start();
    e2e.app
      .get(ConfigService)
      .set('auth.nativeApplications', [
        { ...APPLICATION, signIn: { password: false } },
      ]);
    await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(409);
    await expect(
      e2e.app
        .get(NativeAttemptService)
        .completeFactor(
          attempt.attemptId,
          attempt.attemptSecret,
          await principal(),
        ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('issues one consent code, replays it while valid, and rejects it after expiry', async () => {
    const { attempt, verifier } = await start();
    const factor = await e2e.app
      .get(NativeAttemptService)
      .completeFactor(
        attempt.attemptId,
        attempt.attemptSecret,
        await principal(),
      );
    expect(factor.stage).toBe('consentRequired');
    const url = `/api/auth/native/attempts/${attempt.attemptId}/consent`;
    const first = await request(e2e.httpServer)
      .post(url)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    const reply = unwrapNativeAttemptResult({
      status: first.status,
      body: first.body,
    });
    expect(reply.stage).toBe('codeReady');
    if (reply.stage !== 'codeReady') throw new Error('code was not ready');
    const second = await request(e2e.httpServer)
      .post(url)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    expect(
      unwrapNativeAttemptResult({ status: second.status, body: second.body }),
    ).toEqual(reply);
    const code = new URL(reply.redirectUri).searchParams.get('code');
    expect(code).toBeTruthy();
    const token = await e2e.app.get(NativeTokenService).grant(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: verifier,
      },
      NATIVE_META,
    );
    expect(token.ok).toBe(true);
    e2e.clock.advance(61_000);
    await request(e2e.httpServer)
      .post(url)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(410);
  });

  it('refuses consent after the account authority changes', async () => {
    const { attempt } = await start();
    const verified = await principal();
    await e2e.app
      .get(NativeAttemptService)
      .completeFactor(attempt.attemptId, attempt.attemptSecret, verified);
    await e2e.app
      .get(UnitOfWorkRunner)
      .run((work) =>
        e2e.app.get(AccountSessions).revokeAll(work, verified.userId),
      );
    await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/consent`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(404);
  });

  it('refuses consent after a native provider audience policy change', async () => {
    const { attempt } = await start();
    await e2e.app
      .get(NativeAttemptService)
      .completeFactor(
        attempt.attemptId,
        attempt.attemptSecret,
        await principal(),
      );
    e2e.app.get(ConfigService).set('auth.nativeApplications', [
      {
        ...APPLICATION,
        signIn: { password: true, origins: ['https://app.example.test'] },
      },
    ]);
    await request(e2e.httpServer)
      .post(`/api/auth/native/attempts/${attempt.attemptId}/consent`)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(409);
  });

  it('returns the same authorization when two consent requests race', async () => {
    const { attempt } = await start();
    await e2e.app
      .get(NativeAttemptService)
      .completeFactor(
        attempt.attemptId,
        attempt.attemptSecret,
        await principal(),
      );
    const url = `/api/auth/native/attempts/${attempt.attemptId}/consent`;
    const [first, second] = await Promise.all([
      request(e2e.httpServer)
        .post(url)
        .set('X-Native-Attempt', attempt.attemptSecret),
      request(e2e.httpServer)
        .post(url)
        .set('X-Native-Attempt', attempt.attemptSecret),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const replay = await request(e2e.httpServer)
      .post(url)
      .set('X-Native-Attempt', attempt.attemptSecret)
      .expect(201);
    const winner = first.status === 201 ? first : second;
    expect(replay.body).toEqual(winner.body);
  });
});
