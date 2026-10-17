import { validateEnvironment } from '../env.validation';

const HOST = 'links.example.test';
const MOBILE = {
  clientId: 'mobile',
  displayName: 'Mobile',
  redirectUris: [`https://${HOST}/handoff`],
  firstParty: true,
  signIn: { passkeys: true, rpId: HOST, origins: [`https://${HOST}`] },
};
const BASE_ENV: Record<string, unknown> = {
  NODE_ENV: 'test',
  MONGO_URI: 'mongodb://localhost:27017/authboiler', // feature:mongodb
  POSTGRES_URL: 'postgres://app:placeholder@localhost:5432/authboiler', // feature:postgres
  CLIENT_URL: 'https://web.example.test',
  API_URL: 'https://api.example.test',
  ADMIN_URL: 'https://admin.example.test',
  OAUTH_STATE_SECRET: 's'.repeat(32),
  AUTH_NATIVE_ENABLED: true,
  AUTH_NATIVE_DPOP_NONCE_SECRET: 'native-link-host-fixture-secret-000000000000',
  AUTH_NATIVE_LINK_HOST: HOST,
  AUTH_NATIVE_APPLICATIONS: JSON.stringify([MOBILE]),
};

// Failure: the dedicated host exposes browser/API scripts or claims another host's app links.
describe('native link hostname validation', () => {
  it.each(['API_URL', 'CLIENT_URL', 'ADMIN_URL'] as const)(
    'refuses the %s hostname even with a different port or case',
    (setting) => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          [setting]: 'https://LINKS.example.test:8443',
        }),
      ).toThrow(new RegExp(`AUTH_NATIVE_LINK_HOST.*${setting}`));
    },
  );

  it('requires a known API host before enabling a separate link host', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        AUTH_NATIVE_ENABLED: false,
        API_URL: undefined,
      }),
    ).toThrow(/AUTH_NATIVE_LINK_HOST.*API_URL/u);
  });

  it.each([
    'https://different.example.test/handoff',
    'mobileapp://callback/handoff',
  ])(
    'refuses a production first-party redirect outside HTTPS on the link host',
    (redirect) => {
      expect(() =>
        validateEnvironment({
          ...BASE_ENV,
          NODE_ENV: 'production',
          AUTH_NATIVE_ALLOW_CUSTOM_SCHEME: true,
          AUTH_NATIVE_APPLICATIONS: JSON.stringify([
            { ...MOBILE, redirectUris: [redirect] },
          ]),
        }),
      ).toThrow(
        /AUTH_NATIVE_APPLICATIONS.*mobile.*HTTPS.*AUTH_NATIVE_LINK_HOST/u,
      );
    },
  );

  it('accepts production first-party redirects on the dedicated HTTPS host', () => {
    const result = validateEnvironment({ ...BASE_ENV, NODE_ENV: 'production' });
    expect(result.AUTH_NATIVE_APPLICATIONS).toBe(JSON.stringify([MOBILE]));
  });

  it('requires the link host for production first-party redirects', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        NODE_ENV: 'production',
        AUTH_NATIVE_LINK_HOST: undefined,
      }),
    ).toThrow(/mobile.*AUTH_NATIVE_LINK_HOST/u);
  });

  it('leaves absent link-host configuration without first-party claims unchanged', () => {
    expect(() =>
      validateEnvironment({
        ...BASE_ENV,
        AUTH_NATIVE_LINK_HOST: undefined,
        NODE_ENV: 'production',
        AUTH_NATIVE_APPLICATIONS: JSON.stringify([
          {
            ...MOBILE,
            firstParty: false,
            redirectUris: ['https://product.example.test/handoff'],
          },
        ]),
      }),
    ).not.toThrow();
  });
});
