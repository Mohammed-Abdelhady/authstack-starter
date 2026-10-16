import { validateEnvironment } from '../env.validation';

const BASE_ENV = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'http://localhost:3000',
  OAUTH_STATE_SECRET: 's'.repeat(32),
};
const BROWSER_POLICY_ENV = {
  ...BASE_ENV,
  ADMIN_URL: 'http://localhost:3001',
};
const NATIVE_POLICY_ENV = {
  ...BASE_ENV,
  AUTH_NATIVE_ENABLED: true,
  AUTH_NATIVE_DPOP_NONCE_SECRET: 'n'.repeat(32),
  API_URL: 'http://localhost:3001',
};
const NATIVE_APPLICATION = {
  clientId: 'mobile',
  displayName: 'Mobile',
  redirectUris: ['https://native.example.test/callback'],
};

describe('application admission policy validation', () => {
  it('keeps browser defaults when the new settings are absent', () => {
    expect(validateEnvironment(BASE_ENV)).toMatchObject({
      AUTH_WEB_ENABLED: true,
      CLIENT_URL: 'http://localhost:3000',
    });
  });

  // Failure: an ignored admin policy silently leaves the intended controls inactive.
  it.each(['{}', '{"password":false}', '{"requirePasskey":true}'])(
    'refuses configured admin policy without ADMIN_URL: %s',
    (raw) => {
      expect(() =>
        validateEnvironment({ ...BASE_ENV, AUTH_ADMIN_SIGN_IN: raw }),
      ).toThrow(/AUTH_ADMIN_SIGN_IN.*ADMIN_URL/);
    },
  );

  it.each([
    ['AUTH_WEB_SIGN_IN', undefined],
    ['AUTH_WEB_SIGN_IN', 'open'],
    ['AUTH_ADMIN_SIGN_IN', undefined],
    ['AUTH_ADMIN_SIGN_IN', 'open'],
  ] as const)(
    'refuses public staff sign-up in %s with signUp=%s and names the repair',
    (setting, signUp) => {
      expect(() =>
        validateEnvironment({
          ...BROWSER_POLICY_ENV,
          [setting]: JSON.stringify({ audience: 'staff', signUp }),
        }),
      ).toThrow(new RegExp(`${setting}.*signUp.*closed`));
    },
  );

  it.each(['AUTH_WEB_SIGN_IN', 'AUTH_ADMIN_SIGN_IN'] as const)(
    'allows a closed staff application in %s',
    (setting) => {
      const raw = JSON.stringify({ audience: 'staff', signUp: 'closed' });
      expect(
        validateEnvironment({ ...BROWSER_POLICY_ENV, [setting]: raw })[setting],
      ).toBe(raw);
    },
  );

  it.each(['AUTH_WEB_SIGN_IN', 'AUTH_ADMIN_SIGN_IN'] as const)(
    'refuses a required passkey disabled by the application in %s',
    (setting) => {
      expect(() =>
        validateEnvironment({
          ...BROWSER_POLICY_ENV,
          [setting]: JSON.stringify({ requirePasskey: true, passkeys: false }),
        }),
      ).toThrow(
        new RegExp(
          `${setting}.*requires (?:the passkeys feature|application passkeys)`,
        ),
      );
    },
  );

  it('refuses required browser passkeys when the server disables them', () => {
    expect(() =>
      validateEnvironment({
        ...BROWSER_POLICY_ENV,
        PASSKEYS_ENABLED: false,
        AUTH_ADMIN_SIGN_IN: JSON.stringify({ requirePasskey: true }),
      }),
    ).toThrow(/AUTH_ADMIN_SIGN_IN.*PASSKEYS_ENABLED=true/);
  });

  // feature:passkeys:start
  // Failure: a deployment cannot require a passkey that its application can make.
  it.each(['AUTH_WEB_SIGN_IN', 'AUTH_ADMIN_SIGN_IN'] as const)(
    'accepts an available required passkey in %s',
    (setting) => {
      const raw = JSON.stringify({ requirePasskey: true });
      expect(
        validateEnvironment({ ...BROWSER_POLICY_ENV, [setting]: raw })[setting],
      ).toBe(raw);
    },
  );
  // feature:passkeys:end

  it.each([
    { audience: 'staff' },
    { audience: 'staff', signUp: 'open' },
    { requirePasskey: true },
    { requirePasskey: true, signIn: { passkeys: false } },
  ])('refuses an unsafe enabled native application policy: %p', (policy) => {
    expect(() =>
      validateEnvironment({
        ...NATIVE_POLICY_ENV,
        AUTH_NATIVE_APPLICATIONS: JSON.stringify([
          { ...NATIVE_APPLICATION, ...policy },
        ]),
      }),
    ).toThrow(/AUTH_NATIVE_APPLICATIONS.*mobile.*(?:signUp|requirePasskey)/);
  });

  it('refuses required native passkeys without an exact RP and origins', () => {
    expect(() =>
      validateEnvironment({
        ...NATIVE_POLICY_ENV,
        AUTH_NATIVE_APPLICATIONS: JSON.stringify([
          {
            ...NATIVE_APPLICATION,
            requirePasskey: true,
            signIn: { passkeys: true },
          },
        ]),
      }),
    ).toThrow(/AUTH_NATIVE_APPLICATIONS.*mobile.*origins and rpId/);
  });

  it('refuses required native passkeys when the server disables them', () => {
    expect(() =>
      validateEnvironment({
        ...NATIVE_POLICY_ENV,
        PASSKEYS_ENABLED: false,
        AUTH_NATIVE_APPLICATIONS: JSON.stringify([
          {
            ...NATIVE_APPLICATION,
            requirePasskey: true,
            signIn: {
              passkeys: true,
              rpId: 'native.example.test',
              origins: ['https://native.example.test'],
            },
          },
        ]),
      }),
    ).toThrow(/AUTH_NATIVE_APPLICATIONS.*mobile.*PASSKEYS_ENABLED=true/);
  });

  // feature:passkeys:start
  it('accepts closed native staff with an available required passkey', () => {
    const raw = JSON.stringify([
      {
        ...NATIVE_APPLICATION,
        audience: 'staff',
        signUp: 'closed',
        requirePasskey: true,
        signIn: {
          passkeys: true,
          rpId: 'native.example.test',
          origins: ['https://native.example.test'],
        },
      },
    ]);
    expect(
      validateEnvironment({
        ...NATIVE_POLICY_ENV,
        AUTH_NATIVE_APPLICATIONS: raw,
      }).AUTH_NATIVE_APPLICATIONS,
    ).toBe(raw);
  });
  // feature:passkeys:end

  it('keeps inactive native application settings ignored', () => {
    expect(
      validateEnvironment({ ...BASE_ENV, AUTH_NATIVE_APPLICATIONS: '{' })
        .AUTH_NATIVE_ENABLED,
    ).toBe(false);
  });
});
