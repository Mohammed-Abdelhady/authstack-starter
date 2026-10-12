import { describe, expect, it } from 'vitest';
import { unwrapIdentity, unwrapIdentityBody } from './identity';
import { apiErrorFrom, respond } from './test-support';

const ok = (data: unknown) => ({ success: true, data });

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
