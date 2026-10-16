import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { unwrapNativeAttemptResult, unwrapNativeAttemptStart } from '@app/sdk';
import { NATIVE_ATTEMPT_HEADER } from '../../../src/auth/native/constants/native-attempt';
import { NativeAttemptService } from '../../../src/auth/native/services/native-attempt.service';
import { REQUEST_ID_HEADER } from '../../../src/common/constants/request-id';
import { SIGN_UP_POLICY } from '../../../src/config/constants/host-contracts';
import type { NativeApplicationConfiguration } from '../../../src/config/types/native-application.type';
import { ROLE_AUDIENCE } from '../../../src/host/types/host-role.type';
import { ApplicationRegistry } from '../../../src/session/applications/application-registry';
import { SessionValidator } from '../../../src/session/authority/session-validator';
import { DEFAULT_API_AUDIENCE } from '../../../src/session/constants/client-ids';
import {
  nativeAuthorizeQuery,
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { NativeTokenService } from '../../../src/session/native/token/native-token.service';
import { reconcileStartupApplications } from '../../../src/session/session.module';
import { hashToken } from '../../../src/session/utils/hashing/token-hash';
import { AccountProfileStore } from '../../../src/user/stores/account-profile.store';
import { SEED_USER } from '../../constants/seed-users';
import { arrangeAudiences } from '../../utils/audience-authorization.fixtures';
import { bootE2eApp, type E2eApp } from '../../utils/e2e-app';
import { TEST_NOW } from '../../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { storeNativePolicy } from '../../utils/native/store-native-policy';

const THIRD_PARTY_CLIENT_ID = 'native-third-party';
const APPLICATION: NativeApplicationConfiguration = {
  clientId: NATIVE_CLIENT_ID,
  displayName: 'Native first party',
  redirectUris: [NATIVE_REDIRECT],
  allowedScopes: [DEFAULT_API_AUDIENCE],
  firstParty: true,
  signIn: { password: true },
};
const THIRD_PARTY_APPLICATION: NativeApplicationConfiguration = {
  ...APPLICATION,
  clientId: THIRD_PARTY_CLIENT_ID,
  firstParty: false,
};
const APPLICATIONS = [APPLICATION, THIRD_PARTY_APPLICATION];

describe('native first-party authority (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp(0, {
      nativeEnabled: true,
      nativeCustomSchemeAllowed: true,
      nativeApplications: APPLICATIONS,
    });
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeApplications', APPLICATIONS);
    await e2e.reset();
  });

  afterEach(() => {
    // The audience case configures the admin application; the next reset needs none.
    const config = e2e.app.get(ConfigService);
    config.set('auth.web.signIn', undefined);
    config.set('auth.admin.signIn', undefined);
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  async function start(clientId = NATIVE_CLIENT_ID) {
    const verifier = randomBytes(32).toString('base64url');
    const query = nativeAuthorizeQuery(verifier);
    const response = await request(e2e.httpServer)
      .post('/api/auth/native/attempts')
      .send({
        clientId,
        redirectUri: NATIVE_REDIRECT,
        codeChallenge: query.code_challenge,
        codeChallengeMethod: 'S256',
        state: query.state,
        scopes: [DEFAULT_API_AUDIENCE],
        flow: 'signIn',
      })
      .expect(201);
    return {
      attempt: unwrapNativeAttemptStart({
        status: response.status,
        body: response.body,
      }),
      verifier,
    };
  }

  async function complete(attempt: {
    attemptId: string;
    attemptSecret: string;
  }) {
    const id = await e2e.state.accounts.accountIdFor(SEED_USER.email);
    if (!id) throw new Error('seed account missing');
    const account = await e2e.app.get(AccountProfileStore).findProfile(id);
    if (!account) throw new Error('seed account missing');
    return e2e.app
      .get(NativeAttemptService)
      .completeFactor(attempt.attemptId, attempt.attemptSecret, {
        userId: id,
        userVersion: account.sessionVersion,
        firstFactor: 'password',
        authenticationMethods: ['password'],
      });
  }

  function exchange(code: string, verifier: string) {
    return e2e.app.get(NativeTokenService).grant(
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: NATIVE_REDIRECT,
        client_id: NATIVE_CLIENT_ID,
        code_verifier: verifier,
      },
      NATIVE_META,
    );
  }

  // Failure: first-party completion stalls at consent or reissues an exchangeable code on resume.
  it('completes first-party sign-in directly and resumes the same single-use code', async () => {
    const { attempt, verifier } = await start();
    const completed = await complete(attempt);
    expect(completed.stage).toBe('codeReady');
    if (completed.stage !== 'codeReady') throw new Error('code not ready');
    const resumed = await request(e2e.httpServer)
      .get(`/api/auth/native/attempts/${attempt.attemptId}`)
      .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
      .expect(200);
    expect(
      unwrapNativeAttemptResult({ status: resumed.status, body: resumed.body }),
    ).toEqual(completed);
    const code = new URL(completed.redirectUri).searchParams.get('code');
    if (!code) throw new Error('redirect has no code');
    expect((await exchange(code, verifier)).ok).toBe(true);
    expect(await exchange(code, verifier)).toEqual({
      ok: false,
      status: 400,
      error: 'invalid_grant',
    });
    expect(await e2e.state.sessions.countSessions()).toBe(1);
  });

  // Failure: treating every native application as first party silently bypasses third-party consent.
  it('keeps third-party sign-in behind consent', async () => {
    const { attempt } = await start(THIRD_PARTY_CLIENT_ID);
    expect((await complete(attempt)).stage).toBe('consentRequired');
    expect(await e2e.state.sessions.countSessions()).toBe(0);
  });

  // Failure: exchange loses the policy version or refresh rotates a session after its policy changed.
  it('persists the issuing policy version and refuses stale refresh without rewriting the session', async () => {
    await storeNativePolicy(e2e, NATIVE_CLIENT_ID, 7);
    const { attempt, verifier } = await start();
    const completed = await complete(attempt);
    if (completed.stage !== 'codeReady') throw new Error('code not ready');
    const code = new URL(completed.redirectUri).searchParams.get('code');
    if (!code) throw new Error('redirect has no code');
    const pair = await exchange(code, verifier);
    expect(pair.ok).toBe(true);
    if (!pair.ok) throw new Error('exchange failed');
    const [credential] = await e2e.state.native.credentialsForTokens([
      hashToken(pair.refreshToken),
    ]);
    if (!credential) throw new Error('refresh credential missing');
    const sessions = e2e.app.get(SessionValidator);
    const original = await sessions.findById(credential.sessionId);
    expect(original?.policyVersion).toBe(7);
    expect(
      (await e2e.app.get(ApplicationRegistry).findByClientId(NATIVE_CLIENT_ID))
        ?.policyVersion,
    ).toBe(7);
    await storeNativePolicy(e2e, NATIVE_CLIENT_ID, 8);
    const refresh = await e2e.app.get(NativeTokenService).grant(
      {
        grant_type: 'refresh_token',
        client_id: NATIVE_CLIENT_ID,
        refresh_token: pair.refreshToken,
      },
      NATIVE_META,
    );
    expect(refresh).toEqual({
      ok: false,
      status: 400,
      error: 'invalid_grant',
    });
    expect(await sessions.findById(credential.sessionId)).toEqual(original);
    expect(
      await e2e.state.native.credentialsForTokens([
        hashToken(pair.refreshToken),
      ]),
    ).toEqual([credential]);
    expect(await e2e.state.native.credentialCount()).toBe(2);
  });

  // Failure: a valid password reveals an excluded audience or obtains native session authority.
  it('answers excluded-audience passwords exactly like wrong passwords without issuing a session', async () => {
    // Accounts are mapped first: start-up refuses an audience while one has none.
    await arrangeAudiences(e2e);
    e2e.app.get(ConfigService).set('auth.nativeApplications', [
      {
        ...APPLICATION,
        audience: ROLE_AUDIENCE.STAFF,
        signUp: SIGN_UP_POLICY.CLOSED,
      },
    ]);
    await reconcileStartupApplications(e2e.app);
    const { attempt } = await start();
    const password = (value: string) =>
      request(e2e.httpServer)
        .post(`/api/auth/native/attempts/${attempt.attemptId}/password`)
        .set(NATIVE_ATTEMPT_HEADER, attempt.attemptSecret)
        .set(REQUEST_ID_HEADER, 'native-audience-refusal')
        .send({ email: SEED_USER.email, password: value });
    const wrong = await password('WrongPassword1!');
    const refused = await password(SEED_USER.password);
    expect(wrong.status).toBe(401);
    expect({ status: refused.status, body: refused.body as unknown }).toEqual({
      status: wrong.status,
      body: wrong.body as unknown,
    });
    expect(refused.headers['set-cookie']).toBeUndefined();
    expect(await e2e.state.sessions.countSessions()).toBe(0);
    expect(await e2e.state.native.credentialCount()).toBe(0);
    expect(
      (
        await e2e.app
          .get(NativeAttemptService)
          .authenticate(attempt.attemptId, attempt.attemptSecret)
      ).activeOperationId,
    ).toBeNull();
  });
});
