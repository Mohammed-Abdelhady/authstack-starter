import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../../src/common/enums/error-code.enum';
import { CREDENTIAL_PURPOSE } from '../../../src/session/constants/credential-purpose';
import { NativeAuthorizeService } from '../../../src/session/native/authorize/native-authorize.service';
import { NativeTokenService } from '../../../src/session/native/token/native-token.service';
import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  nativeAuthorizeQuery,
} from '../../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_ADMIN, SEED_USER } from '../../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../../utils/e2e-app';
import { createNativeApplication } from '../../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../../utils/hook-timeouts';
import { TEST_NOW } from '../../utils/frozen-clock';

interface ApiErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

interface SessionRow {
  id: string;
  credentialPurpose: string;
  isCurrent: boolean;
}

interface NativeGrant {
  accessToken: string;
  refreshToken: string;
}

describe('native sessions and bearer precedence (e2e)', () => {
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
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
  });

  it('authenticates the bearer user when a cookie for another user is also sent', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const grant = await issueNativeGrantFor(e2e, SEED_ADMIN.email);

    const response = await browser
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${grant.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(SEED_ADMIN.email);
  });

  it('fails on an invalid bearer without falling back to the cookie', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);

    const response = await browser
      .get('/api/user/profile')
      .set('Authorization', 'Bearer invalid-native-token');

    expect(response.status).toBe(401);
    expect((response.body as ApiErrorBody).error.code).toBe(
      ErrorCode.SESSION_INVALID,
    );
  });

  it('marks the native session current and browser sessions not for a bearer caller', async () => {
    await loginAs(e2e.httpServer, SEED_USER);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);

    const response = await request(e2e.httpServer)
      .get('/api/user/sessions')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);

    const sessions = response.body.data.sessions as SessionRow[];
    expect(sessions).toHaveLength(2);
    const current = sessions.filter((session) => session.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]?.credentialPurpose).toBe(
      CREDENTIAL_PURPOSE.NATIVE_ACCESS,
    );
    const browserRows = sessions.filter(
      (session) =>
        session.credentialPurpose === CREDENTIAL_PURPOSE.BROWSER_SESSION,
    );
    expect(browserRows).toHaveLength(1);
    expect(browserRows[0]?.isCurrent).toBe(false);
  });

  it('refuses a bearer caller revoking its own session', async () => {
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);
    const listed = await request(e2e.httpServer)
      .get('/api/user/sessions')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);
    const sessions = listed.body.data.sessions as SessionRow[];
    const current = sessions.find((session) => session.isCurrent);
    if (!current) {
      throw new Error('bearer session is not marked current');
    }

    const response = await request(e2e.httpServer)
      .delete(`/api/user/sessions/${current.id}`)
      .set('Authorization', `Bearer ${grant.accessToken}`);

    expect(response.status).toBe(400);
    expect((response.body as ApiErrorBody).error.code).toBe(
      ErrorCode.CANNOT_REVOKE_CURRENT_SESSION,
    );
  });

  it('lets a bearer caller revoke other sessions while keeping its own', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);

    const revoked = await request(e2e.httpServer)
      .post('/api/user/sessions/revoke-others')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);
    expect(revoked.body.data.revokedCount).toBe(1);

    const remaining = await request(e2e.httpServer)
      .get('/api/user/sessions')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);
    const sessions = remaining.body.data.sessions as SessionRow[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.isCurrent).toBe(true);
    expect(sessions[0]?.credentialPurpose).toBe(
      CREDENTIAL_PURPOSE.NATIVE_ACCESS,
    );

    const cookieNowInvalid = await browser.get('/api/user/profile');
    expect(cookieNowInvalid.status).toBe(401);
  });

  it('signs a bearer caller out by revoking its token family', async () => {
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const grant = await issueNativeGrantFor(e2e, SEED_USER.email);

    const logout = await request(e2e.httpServer)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${grant.accessToken}`)
      .expect(200);
    expect(logout.body).toEqual({
      success: true,
      data: { message: 'Logout successful' },
    });

    const access = await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${grant.accessToken}`);
    expect(access.status).toBe(401);
    expect((access.body as ApiErrorBody).error.code).toBe(
      ErrorCode.SESSION_INVALID,
    );

    const refresh = await request(e2e.httpServer)
      .post('/api/oauth/token')
      .send({
        grant_type: 'refresh_token',
        refresh_token: grant.refreshToken,
        client_id: NATIVE_CLIENT_ID,
      });
    expect(refresh.status).toBe(400);
    expect(refresh.body).toEqual({ error: 'invalid_grant' });

    const browserStillSignedIn = await browser
      .get('/api/user/profile')
      .expect(200);
    expect(browserStillSignedIn.body.data.email).toBe(SEED_USER.email);
    const browserSessions = await browser.get('/api/user/sessions').expect(200);
    expect(browserSessions.body.data.sessions).toHaveLength(1);
    expect(browserSessions.body.data.sessions[0].isCurrent).toBe(true);
  });

  it('keeps the session cookie when the refused credential is a bearer', async () => {
    const cookieUser = await loginAs(e2e.httpServer, SEED_USER);

    const refused = await cookieUser
      .get('/api/user/profile')
      .set('Authorization', 'Bearer invalid-native-token');
    expect(refused.status).toBe(401);
    expect((refused.body as ApiErrorBody).error.code).toBe(
      ErrorCode.SESSION_INVALID,
    );
    expect(refused.headers['set-cookie']).toBeUndefined();

    const cookieOnly = await cookieUser.get('/api/user/profile').expect(200);
    expect(cookieOnly.body.data.email).toBe(SEED_USER.email);

    const stale = await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Cookie', 'sid=stale-cookie-token');
    expect(stale.status).toBe(401);
    const cleared = stale.headers['set-cookie'];
    expect(Array.isArray(cleared)).toBe(true);
    expect(String(cleared?.[0])).toMatch(/^sid=;/);
  });

  it('ends only the bearer session when a cookie is sent along', async () => {
    const cookieUser = await loginAs(e2e.httpServer, SEED_USER);
    const foreignGrant = await issueNativeGrantFor(e2e, SEED_ADMIN.email);

    const logout = await cookieUser
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${foreignGrant.accessToken}`)
      .expect(200);
    expect(logout.headers['set-cookie']).toBeUndefined();

    const bearerDead = await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${foreignGrant.accessToken}`);
    expect(bearerDead.status).toBe(401);

    const cookieAlive = await cookieUser.get('/api/user/profile').expect(200);
    expect(cookieAlive.body.data.email).toBe(SEED_USER.email);
  });

  it('never performs a state change as the cookie user when a bearer is also sent', async () => {
    const cookieUser = await loginAs(e2e.httpServer, SEED_USER);
    const foreignGrant = await issueNativeGrantFor(e2e, SEED_ADMIN.email);

    const invalid = await cookieUser
      .patch('/api/user/profile')
      .set('Authorization', 'Bearer invalid-native-token')
      .send({ name: 'Deputy Name' });
    expect(invalid.status).toBe(401);
    expect(invalid.headers['set-cookie']).toBeUndefined();

    const foreign = await cookieUser
      .patch('/api/user/profile')
      .set('Authorization', `Bearer ${foreignGrant.accessToken}`)
      .send({ name: 'Deputy Name' });
    expect(foreign.status).toBe(200);

    const cookieProfile = await cookieUser.get('/api/user/profile').expect(200);
    expect(cookieProfile.body.data.name).toBe('Seed User');
    const bearerProfile = await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${foreignGrant.accessToken}`)
      .expect(200);
    expect(bearerProfile.body.data.name).toBe('Deputy Name');
  });
});

async function issueNativeGrantFor(
  e2e: E2eApp,
  email: string,
): Promise<NativeGrant> {
  const user = await e2e.state.accounts.accountIdFor(email);
  if (!user) {
    throw new Error('seed user is missing');
  }
  const verifier = randomBytes(32).toString('base64url');
  const authorize = e2e.app.get(NativeAuthorizeService);
  const begun = await authorize.begin(nativeAuthorizeQuery(verifier));
  if (!begun.ok) {
    throw new Error(begun.error);
  }
  const approved = await authorize.approve(user, begun.transactionId, [
    'password',
  ]);
  const code = new URL(approved.redirectUri).searchParams.get('code');
  if (!code) {
    throw new Error('authorization code is missing');
  }
  const result = await e2e.app.get(NativeTokenService).grant(
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: NATIVE_REDIRECT,
      client_id: NATIVE_CLIENT_ID,
      code_verifier: verifier,
    },
    NATIVE_META,
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}
