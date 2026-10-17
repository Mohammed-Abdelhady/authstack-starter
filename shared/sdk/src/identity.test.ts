import { describe, expect, it } from 'vitest';
import { unwrapIdentity, unwrapIdentityBody } from './identity';
import { apiErrorFrom, respond } from './test-support';

const ok = (data: unknown) => ({ success: true, data });
const IDENTITY_USER = {
  locale: 'en',
  id: 'account-1',
  email: 'account@example.test',
  name: 'Account',
  role: 'user',
  permissions: [],
  authProvider: 'email',
  linkedProviders: ['email'],
  isVerified: true,
  // feature:totp:start
  twoFactorEnabled: false,
  // feature:totp:end
  // feature:passkeys:start
  passkeyCount: 0,
  // feature:passkeys:end
};

describe('identity envelope', () => {
  it('reads the signed-out branch with no user', () => {
    expect(unwrapIdentityBody(ok({ authenticated: false, user: null }))).toEqual({
      authenticated: false,
      user: null,
    });
  });

  it.each([
    { authenticated: false, user: {} },
    { authenticated: true, user: null },
    { authenticated: 'false', user: null },
    { authenticated: true, user: { id: 'partial' } },
  ])('refuses an inconsistent identity payload', (data) => {
    const error = apiErrorFrom(() => unwrapIdentityBody(ok(data)));
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(200);
  });

  // feature:totp:start
  it('rejects a non-boolean two-factor state', () => {
    const error = apiErrorFrom(() =>
      unwrapIdentityBody(
        ok({
          authenticated: true,
          user: { ...IDENTITY_USER, twoFactorEnabled: 'false' },
        }),
      ),
    );

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(200);
  });
  // feature:totp:end

  // feature:passkeys:start
  it('rejects a negative passkey count', () => {
    const error = apiErrorFrom(() =>
      unwrapIdentityBody(ok({ authenticated: true, user: { ...IDENTITY_USER, passkeyCount: -1 } })),
    );

    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.status).toBe(200);
  });
  // feature:passkeys:end

  it.each([
    [401, 'SESSION_INVALID'],
    [503, 'SERVICE_UNAVAILABLE'],
  ])('keeps the %i error envelope', (status, code) => {
    const error = apiErrorFrom(() =>
      unwrapIdentity(respond(status, { success: false, error: { code, message: 'Unavailable' } })),
    );
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });
});

describe('account mail locale handoff', () => {
  it.each([
    'en',
    'ar', // feature:locale-ar
  ])('retains the actual %s locale through identity', (locale) => {
    const result = unwrapIdentityBody(
      ok({ authenticated: true, user: { ...IDENTITY_USER, locale } }),
    );
    expect(result.authenticated && result.user.locale).toBe(locale);
  });

  it.each([null, 4, undefined])('refuses a missing or non-text locale', (locale) => {
    const error = apiErrorFrom(() =>
      unwrapIdentityBody(ok({ authenticated: true, user: { ...IDENTITY_USER, locale } })),
    );
    expect({ status: error.status, code: error.code }).toEqual({
      status: 200,
      code: 'UNKNOWN_ERROR',
    });
  });
});
describe('observed own-profile versions', () => {
  it('preserves a server version without manufacturing one for an older server', () => {
    const legacy = unwrapIdentityBody(ok({ authenticated: true, user: IDENTITY_USER }));
    const current = unwrapIdentityBody(
      ok({
        authenticated: true,
        user: { ...IDENTITY_USER, version: 7 },
      }),
    );
    expect(legacy.authenticated && Object.hasOwn(legacy.user, 'version')).toBe(false);
    expect(current.authenticated && current.user.version).toBe(7);
  });

  it.each([null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '7'])(
    'refuses malformed present versions rather than exposing a writable revision',
    (version) => {
      expect(
        apiErrorFrom(() =>
          unwrapIdentityBody(
            ok({
              authenticated: true,
              user: { ...IDENTITY_USER, version },
            }),
          ),
        ),
      ).toMatchObject({ code: 'UNKNOWN_ERROR', status: 200 });
    },
  );
});
