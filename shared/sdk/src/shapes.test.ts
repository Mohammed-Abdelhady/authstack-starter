import { describe, expect, it } from 'vitest';
import { unwrapAuthMethods, unwrapAuthMethodsBody } from './auth-methods';
import { API_PATHS } from './paths';
import { unwrapSessionList, unwrapSessionListBody } from './sessions';
import { unwrapObject, unwrapObjectBody } from './shapes';
import { apiErrorFrom, respond, thrownBy } from './test-support';

const ok = (data: unknown) => ({ success: true, data });

const SESSION = {
  id: '65a000000000000000000001',
  userAgent: 'Mozilla/5.0',
  ip: '203.0.113.10',
  createdAt: '2026-01-15T10:30:00.000Z',
  isCurrent: true,
};

describe('unwrapObject', () => {
  it('returns data that is an object', () => {
    expect(unwrapObject(respond(200, ok({ message: 'done' })))).toEqual({ message: 'done' });
    expect(unwrapObjectBody(ok({ revokedCount: 2 }))).toEqual({ revokedCount: 2 });
  });

  it.each([
    ['null', null],
    ['missing', undefined],
    ['a string', 'done'],
    ['a list', [{ message: 'done' }]],
  ])('refuses data that is %s', (_label, data) => {
    for (const run of [
      () => unwrapObject(respond(200, ok(data))),
      () => unwrapObjectBody(ok(data)),
    ]) {
      const error = apiErrorFrom(run);

      expect(error.status).toBe(200);
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.message).toMatch(/data is not an object/);
    }
  });

  it('keeps the error envelope of a failed response', () => {
    const error = apiErrorFrom(() =>
      unwrapObject(
        respond(401, { success: false, error: { code: 'SESSION_INVALID', message: 'Invalid' } }),
      ),
    );

    expect(error.status).toBe(401);
    expect(error.code).toBe('SESSION_INVALID');
  });
});

describe('unwrapSessionList', () => {
  it('returns the sessions and the total', () => {
    const data = { sessions: [SESSION], total: 1 };

    expect(unwrapSessionList(respond(200, ok(data)))).toEqual({ sessions: [SESSION], total: 1 });
    expect(unwrapSessionListBody(ok(data))).toEqual({ sessions: [SESSION], total: 1 });
  });

  it('counts the sessions when the server sends no total', () => {
    expect(unwrapSessionListBody(ok({ sessions: [SESSION, SESSION] })).total).toBe(2);
  });

  it.each([
    ['data that is null', null, /data is not an object/],
    ['data without sessions', {}, /data\.sessions is not a list/],
    ['sessions that are an object', { sessions: { 0: SESSION } }, /data\.sessions is not a list/],
    ['sessions that are null', { sessions: null, total: 0 }, /data\.sessions is not a list/],
  ])('refuses %s', (_label, data, problem) => {
    for (const run of [
      () => unwrapSessionList(respond(200, ok(data))),
      () => unwrapSessionListBody(ok(data)),
    ]) {
      const error = apiErrorFrom(run);

      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.message).toMatch(problem);
    }
  });
});

describe('unwrapAuthMethods', () => {
  it('returns every switch the server sent', () => {
    const methods = {
      password: true,
      magicLink: true,
      twoFactor: false,
      passkeys: true,
      oauth: [{ id: 'google', displayName: 'Google' }],
    };

    expect(unwrapAuthMethods(respond(200, ok({ methods })))).toEqual({
      password: true,
      magicLink: true,
      twoFactor: false,
      passkeys: true,
      oauth: [{ id: 'google', displayName: 'Google' }],
    });
  });

  it('reads a method the server left out as off', () => {
    expect(unwrapAuthMethodsBody(ok({ methods: { password: false, passkeys: true } }))).toEqual({
      password: false,
      magicLink: false,
      twoFactor: false,
      passkeys: true,
      oauth: [],
    });
  });

  it.each([
    ['data that is null', null, /data is not an object/],
    ['data without methods', {}, /methods is not an object/],
    ['methods that are a list', { methods: [] }, /methods is not an object/],
    ['methods without password', { methods: {} }, /methods\.password is not a boolean/],
    ['a password switch sent as text', { methods: { password: 'true' } }, /methods\.password/],
    [
      'a switch sent as text',
      { methods: { password: true, passkeys: 'yes' } },
      /methods\.passkeys/,
    ],
    [
      'a switch sent as null',
      { methods: { password: true, magicLink: null } },
      /methods\.magicLink/,
    ],
    ['providers that are not a list', { methods: { password: true, oauth: {} } }, /methods\.oauth/],
  ])('refuses %s', (_label, data, problem) => {
    for (const run of [
      () => unwrapAuthMethods(respond(200, ok(data))),
      () => unwrapAuthMethodsBody(ok(data)),
    ]) {
      const error = apiErrorFrom(run);

      expect(error.status).toBe(200);
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.message).toMatch(problem);
    }
  });
});

describe('API_PATHS.user.session', () => {
  it('builds the path of one session', () => {
    expect(API_PATHS.user.session('65a000000000000000000001')).toBe(
      '/api/user/sessions/65a000000000000000000001',
    );
  });

  it('keeps separators and query characters inside the segment', () => {
    expect(API_PATHS.user.session('../profile?x=1#y')).toBe(
      '/api/user/sessions/..%2Fprofile%3Fx%3D1%23y',
    );
  });

  it.each(['', '.', '..'])('refuses %j, which a URL parser would resolve away', (sessionId) => {
    const error = thrownBy(() => API_PATHS.user.session(sessionId));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toContain('session id');
  });

  it.each([
    ['...', '/api/user/sessions/...'],
    ['.a', '/api/user/sessions/.a'],
    ['a..b', '/api/user/sessions/a..b'],
  ])('accepts %j, which stays one segment', (sessionId, path) => {
    expect(API_PATHS.user.session(sessionId)).toBe(path);
  });
});

describe('session device parts compatibility', () => {
  it('passes optional device parts through the real response reader', () => {
    const body = ok({
      sessions: [
        {
          ...SESSION,
          deviceName: 'Legacy phrase',
          deviceParts: {
            kind: 'browser',
            browserName: 'Chrome',
            browserMajorVersion: '140',
            platformName: 'macOS',
            platformVersion: '10.15',
          },
        },
      ],
      total: 1,
    });
    const session = unwrapSessionListBody(body).sessions[0];
    expect({ deviceName: session?.deviceName, deviceParts: session?.deviceParts }).toEqual({
      deviceName: 'Legacy phrase',
      deviceParts: {
        kind: 'browser',
        browserName: 'Chrome',
        browserMajorVersion: '140',
        platformName: 'macOS',
        platformVersion: '10.15',
      },
    });
  });
});
