import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../env.validation';
import {
  nativeSessionPolicy,
  readBrowserSessionLimits,
} from './session-limit-config';

const BASE_ENV = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'http://localhost:3000',
  OAUTH_STATE_SECRET: 's'.repeat(32),
};
const ADMIN = { absoluteHours: 8, idleMinutes: 15, cap: 5 };

function browser(session: object, clientId: 'web' | 'admin' = 'web') {
  return readBrowserSessionLimits(
    new ConfigService({ auth: { [clientId]: { session } } }),
    clientId,
  );
}

describe('session limit configuration', () => {
  // Failure: configured admin sessions exceed a fixed safety ceiling.
  it.each([{ absoluteHours: 9 }, { idleMinutes: 16 }, { cap: 6 }])(
    'refuses above-bound admin settings at startup: %p',
    (change) => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          AUTH_ADMIN_SESSION: JSON.stringify({ ...ADMIN, ...change }),
        }),
      ).toThrow(/AUTH_ADMIN_SESSION.*admin limits/);
    },
  );

  it('accepts the exact admin upper bounds and converts their units', () => {
    expect(browser(ADMIN, 'admin')).toEqual({
      policy: { absoluteLifetimeMs: 28_800_000, idleLifetimeMs: 900_000 },
      sessionCap: 5,
    });
  });

  // Failure: overflow creates an invalid deadline or an unpersistable SQL cap.
  it.each([
    { absoluteHours: Number.MAX_SAFE_INTEGER },
    { idleMinutes: Number.MAX_SAFE_INTEGER },
    { absoluteHours: 2_400_000_000 },
    { cap: 2_147_483_648 },
    { cap: 0 },
  ])('refuses unsafe web limits before writing: %p', (change) => {
    expect(() => browser({ ...ADMIN, ...change })).toThrow(/AUTH_WEB_SESSION/);
  });

  it('rejects unsafe native conversion with the client and selected pair named', () => {
    expect(() =>
      nativeSessionPolicy(
        {
          bound: { absoluteHours: 24, idleMinutes: 30 },
          unbound: { absoluteHours: Number.MAX_SAFE_INTEGER, idleMinutes: 1 },
        },
        'AUTH_NATIVE_APPLICATIONS entry mobile.session',
      ),
    ).toThrow(
      /AUTH_NATIVE_APPLICATIONS entry mobile.session.unbound.absoluteHours/,
    );
  });

  // Failure: stale raw environment settings revive a removed typed policy.
  it('reads browser limits only from the typed nested configuration', () => {
    const config = new ConfigService({
      AUTH_WEB_SESSION: 'stale raw setting',
    });
    expect(readBrowserSessionLimits(config, 'web')).toBeUndefined();
    config.set('auth.web.session', {
      absoluteHours: 2,
      idleMinutes: 3,
      cap: 4,
    });
    expect(readBrowserSessionLimits(config, 'web')).toEqual({
      policy: { absoluteLifetimeMs: 7_200_000, idleLifetimeMs: 180_000 },
      sessionCap: 4,
    });
  });

  // Failure: startup admits an unbound credential with a longer lifetime.
  it.each([
    { field: 'absoluteHours', unbound: { absoluteHours: 25, idleMinutes: 5 } },
    { field: 'idleMinutes', unbound: { absoluteHours: 1, idleMinutes: 31 } },
  ])(
    'refuses a longer native unbound $field at startup',
    ({ field, unbound }) => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          AUTH_NATIVE_ENABLED: 'true',
          API_URL: 'https://api.example.test',
          AUTH_NATIVE_DPOP_NONCE_SECRET: 'n'.repeat(32),
          AUTH_NATIVE_APPLICATIONS: JSON.stringify([
            {
              clientId: 'mobile',
              displayName: 'Mobile',
              redirectUris: ['https://mobile.example.test/callback'],
              session: {
                bound: { absoluteHours: 24, idleMinutes: 30 },
                unbound,
              },
            },
          ]),
        }),
      ).toThrow(
        new RegExp(
          `AUTH_NATIVE_APPLICATIONS.*mobile.*unbound.${field}.*reduce`,
        ),
      );
    },
  );

  it('accepts equal native bound and unbound session limits', () => {
    expect(
      nativeSessionPolicy(
        {
          bound: { absoluteHours: 2, idleMinutes: 3 },
          unbound: { absoluteHours: 2, idleMinutes: 3 },
        },
        'AUTH_NATIVE_APPLICATIONS entry mobile.session',
      ),
    ).toEqual({
      absoluteLifetimeMs: 7_200_000,
      idleLifetimeMs: 180_000,
      unboundAbsoluteLifetimeMs: 7_200_000,
      unboundIdleLifetimeMs: 180_000,
    });
  });
});
