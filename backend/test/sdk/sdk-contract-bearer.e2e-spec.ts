import { ApiError, OAuthError } from '@app/sdk';
import { ConfigService } from '@nestjs/config';
import {
  NATIVE_CLIENT_ID,
  NATIVE_REDIRECT,
} from '../utils/native/native-authorize.fixtures';
import {
  apiErrorOf,
  bearerClient,
  cookieClient,
  publicClient,
  rejectionOf,
  required,
  signInNative,
} from '../utils/sdk/sdk-transport';
import {
  bootContractApp,
  contractNativeSessionId,
  resetContractApp,
  type E2eApp,
} from '../utils/sdk/sdk-contract.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('sdk contract over a bearer transport', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootContractApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await resetContractApp(e2e);
  });

  it('exchanges a code, reads the profile with the bearer, refreshes and revokes', async () => {
    const { tokens } = await signInNative(e2e);
    const client = publicClient(e2e);

    expect(tokens).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 300,
      refreshToken: expect.any(String),
      scope: 'api',
    });
    expect(tokens.accessToken).not.toBe(tokens.refreshToken);

    const profile = await bearerClient(e2e, tokens.accessToken).profile.get();
    expect(profile.email).toBe('user@seed.local');

    const refreshed = await client.oauth.refresh({
      refreshToken: tokens.refreshToken,
      clientId: NATIVE_CLIENT_ID,
    });
    expect(refreshed.tokenType).toBe('Bearer');
    expect(refreshed.expiresIn).toBe(300);
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);
    expect(refreshed.refreshToken).not.toBe(tokens.refreshToken);
    expect(
      (await bearerClient(e2e, refreshed.accessToken).profile.get()).email,
    ).toBe('user@seed.local');

    const revoked = await client.oauth.revoke({
      token: refreshed.refreshToken,
      clientId: NATIVE_CLIENT_ID,
    });
    expect(revoked).toBeUndefined();

    const afterRevoke = await apiErrorOf(
      bearerClient(e2e, refreshed.accessToken).profile.get(),
    );
    expect(afterRevoke.status).toBe(401);
    expect(afterRevoke.code).toBe('SESSION_INVALID');

    const reused = await rejectionOf(
      client.oauth.refresh({
        refreshToken: refreshed.refreshToken,
        clientId: NATIVE_CLIENT_ID,
      }),
    );
    expect(reused).toBeInstanceOf(OAuthError);
    expect(reused).not.toBeInstanceOf(ApiError);
    expect(reused).toMatchObject({ status: 400, error: 'invalid_grant' });
  });

  it('signs out the bearer session and its token family stops working', async () => {
    const { tokens } = await signInNative(e2e);
    const client = bearerClient(e2e, tokens.accessToken);

    const result = await client.auth.signOut();
    expect(result).toEqual({ message: 'Logout successful' });

    const access = await apiErrorOf(client.profile.get());
    expect(access.status).toBe(401);
    expect(access.code).toBe('SESSION_INVALID');

    const refresh = await rejectionOf(
      publicClient(e2e).oauth.refresh({
        refreshToken: tokens.refreshToken,
        clientId: NATIVE_CLIENT_ID,
      }),
    );
    expect(refresh).toBeInstanceOf(OAuthError);
    expect(refresh).toMatchObject({ status: 400, error: 'invalid_grant' });
  });

  it('revokes the other sessions and keeps the bearer session', async () => {
    const { browser, tokens } = await signInNative(e2e);

    const revoked = await bearerClient(
      e2e,
      tokens.accessToken,
    ).sessions.revokeOthers();
    expect(revoked).toEqual({ revokedCount: 1 });

    const remaining = await bearerClient(
      e2e,
      tokens.accessToken,
    ).sessions.list();
    expect(remaining.total).toBe(1);
    expect(remaining.sessions.map((session) => session.id)).toEqual([
      await contractNativeSessionId(e2e),
    ]);
    expect(remaining.sessions.map((session) => session.isCurrent)).toEqual([
      true,
    ]);

    const cookie = await apiErrorOf(cookieClient(browser).profile.get());
    expect(cookie.status).toBe(401);
    expect(cookie.code).toBe('SESSION_INVALID');
  });

  it('lists the bearer session as current next to the browser session', async () => {
    const { tokens } = await signInNative(e2e);

    const list = await bearerClient(e2e, tokens.accessToken).sessions.list();

    expect(list.total).toBe(2);
    expect(list.sessions.map((session) => session.isCurrent).sort()).toEqual([
      false,
      true,
    ]);
    expect(list.sessions.map((session) => session.id)).toContain(
      await contractNativeSessionId(e2e),
    );
    const current = required(
      list.sessions.find((session) => session.isCurrent),
      'current session',
    );
    expect(current.id).toBe(await contractNativeSessionId(e2e));
    expect(current.credentialPurpose).toBe('native_access');
    const browserRows = list.sessions.filter(
      (session) => session.credentialPurpose === 'browser_session',
    );
    expect(browserRows).toHaveLength(1);
    expect(browserRows.map((session) => session.isCurrent)).toEqual([false]);
  });

  it('refuses a bearer revoking the session it is running on', async () => {
    const { tokens } = await signInNative(e2e);
    const client = bearerClient(e2e, tokens.accessToken);

    const error = await apiErrorOf(
      client.sessions.revoke(await contractNativeSessionId(e2e)),
    );

    expect(error.status).toBe(400);
    expect(error.code).toBe('CANNOT_REVOKE_CURRENT_SESSION');
    expect((await client.profile.get()).email).toBe('user@seed.local');
  });

  it('surfaces the kill switch reason through the client when native sign-in is off', async () => {
    e2e.app.get(ConfigService).set('auth.nativeEnabled', false);
    const client = publicClient(e2e);

    const refresh = await rejectionOf(
      client.oauth.refresh({
        refreshToken: 'unused-refresh-token',
        clientId: NATIVE_CLIENT_ID,
      }),
    );
    expect(refresh).toBeInstanceOf(OAuthError);
    expect(refresh).not.toBeInstanceOf(ApiError);
    expect(refresh).toMatchObject({
      status: 400,
      error: 'unauthorized_client',
      errorDescription: 'NATIVE_AUTH_DISABLED',
    });

    const exchange = await rejectionOf(
      client.oauth.exchangeCode({
        code: 'unused-code',
        codeVerifier: 'a'.repeat(43),
        redirectUri: NATIVE_REDIRECT,
        clientId: NATIVE_CLIENT_ID,
      }),
    );
    expect(exchange).toBeInstanceOf(OAuthError);
    expect(exchange).toMatchObject({
      status: 400,
      error: 'unauthorized_client',
      errorDescription: 'NATIVE_AUTH_DISABLED',
    });
  });
});
