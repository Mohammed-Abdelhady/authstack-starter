import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { NativeAuthorizeService } from '../../src/session/native/authorize/native-authorize.service';
import { NativeTokenService } from '../../src/session/native/token/native-token.service';
import {
  NATIVE_CLIENT_ID,
  NATIVE_META,
  NATIVE_REDIRECT,
  nativeAuthorizeQuery,
} from '../../src/session/native/harness/native-oauth-requests.harness-spec';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { createNativeApplication } from '../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';
import { TEST_NOW } from '../utils/frozen-clock';

interface ApiErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

interface Victim {
  browser: TestAgent;
  accessToken: string;
  browserSessionId: string;
  nativeSessionId: string;
}

describe('sessions of another user stay untouched (e2e)', () => {
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

  it('refuses a cookie caller ending another user browser and native sessions', async () => {
    const victim = await seedVictim(e2e);
    const attacker = await loginAs(e2e.httpServer, SEED_USER);

    for (const sessionId of [victim.browserSessionId, victim.nativeSessionId]) {
      const response = await attacker.delete(`/api/user/sessions/${sessionId}`);
      expect(response.status).toBe(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        ErrorCode.SESSION_NOT_FOUND,
      );
    }

    await victim.browser.get('/api/user/profile').expect(200);
    await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${victim.accessToken}`)
      .expect(200);
  });

  it('refuses a bearer caller ending another user browser and native sessions', async () => {
    const victim = await seedVictim(e2e);
    const attackerGrant = await issueNativeGrantFor(e2e, SEED_USER.email);

    for (const sessionId of [victim.browserSessionId, victim.nativeSessionId]) {
      const response = await request(e2e.httpServer)
        .delete(`/api/user/sessions/${sessionId}`)
        .set('Authorization', `Bearer ${attackerGrant.accessToken}`);
      expect(response.status).toBe(404);
      expect((response.body as ApiErrorBody).error.code).toBe(
        ErrorCode.SESSION_NOT_FOUND,
      );
    }

    await victim.browser.get('/api/user/profile').expect(200);
    await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${victim.accessToken}`)
      .expect(200);
  });
});

async function seedVictim(e2e: E2eApp): Promise<Victim> {
  const browser = await loginAs(e2e.httpServer, SEED_ADMIN);
  const grant = await issueNativeGrantFor(e2e, SEED_ADMIN.email);
  const sessions = await browser.get('/api/user/sessions').expect(200);
  const rows = sessions.body.data.sessions as {
    id: string;
    isCurrent: boolean;
  }[];
  const current = rows.find((row) => row.isCurrent);
  if (!current) {
    throw new Error('victim browser session is not marked current');
  }
  const nativeRows = rows.filter((row) => !row.isCurrent);
  if (nativeRows.length !== 1 || !nativeRows[0]) {
    throw new Error('expected one victim native session');
  }
  return {
    browser,
    accessToken: grant.accessToken,
    browserSessionId: current.id,
    nativeSessionId: nativeRows[0].id,
  };
}

async function issueNativeGrantFor(
  e2e: E2eApp,
  email: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const userId = await e2e.state.accounts.accountIdFor(email);
  if (!userId) {
    throw new Error('seed user is missing');
  }
  const verifier = randomBytes(32).toString('base64url');
  const authorize = e2e.app.get(NativeAuthorizeService);
  const begun = await authorize.begin(nativeAuthorizeQuery(verifier));
  if (!begun.ok) {
    throw new Error(begun.error);
  }
  const approved = await authorize.approve(userId, begun.transactionId, [
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
  return { accessToken: result.accessToken, refreshToken: result.refreshToken };
}
