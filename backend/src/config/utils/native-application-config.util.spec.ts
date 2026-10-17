import { parseNativeApplications } from './native-application-config.util';

const VALID_APPLICATION = {
  clientId: 'com.example.mobile',
  displayName: 'Example Mobile',
  redirectUris: ['com.example.mobile://oauth/callback'],
};

describe('parseNativeApplications', () => {
  it.each([
    ['unset configuration', undefined, []],
    ['blank configuration', '   ', []],
    ['empty application list', '[]', []],
    [
      'defaults scopes to the first-party web scopes',
      JSON.stringify([VALID_APPLICATION]),
      [
        {
          ...VALID_APPLICATION,
          allowedScopes: ['api'],
        },
      ],
    ],
    [
      'keeps the api scope and multiple redirect addresses',
      JSON.stringify([
        {
          ...VALID_APPLICATION,
          redirectUris: [
            'com.example.mobile://oauth/callback',
            'http://127.0.0.1:5100/callback',
          ],
          allowedScopes: ['api'],
        },
      ]),
      [
        {
          ...VALID_APPLICATION,
          redirectUris: [
            'com.example.mobile://oauth/callback',
            'http://127.0.0.1:5100/callback',
          ],
          allowedScopes: ['api'],
        },
      ],
    ],
    [
      'accepts the maximum client id length',
      JSON.stringify([
        {
          ...VALID_APPLICATION,
          clientId: 'a'.repeat(128),
        },
      ]),
      [
        {
          ...VALID_APPLICATION,
          clientId: 'a'.repeat(128),
          allowedScopes: ['api'],
        },
      ],
    ],
  ])('%s', (_name, raw, expected) => {
    expect(parseNativeApplications(raw)).toEqual(expected);
  });

  it.each([
    ['a narrower scope', ['profile.read']],
    ['the api scope beside another scope', ['api', 'profile:read']],
    ['the api scope in another letter case', ['API']],
  ])('refuses %s and names the application', (_name, allowedScopes) => {
    expect(() =>
      parseNativeApplications(
        JSON.stringify([{ ...VALID_APPLICATION, allowedScopes }]),
      ),
    ).toThrow(
      'AUTH_NATIVE_APPLICATIONS entry "com.example.mobile": allowedScopes must be exactly ["api"]',
    );
  });

  it('refuses a narrower scope on the second application only', () => {
    expect(() =>
      parseNativeApplications(
        JSON.stringify([
          VALID_APPLICATION,
          {
            ...VALID_APPLICATION,
            clientId: 'com.example.widget',
            redirectUris: ['com.example.widget://oauth/callback'],
            allowedScopes: ['profile.read'],
          },
        ]),
      ),
    ).toThrow(
      'AUTH_NATIVE_APPLICATIONS entry "com.example.widget": allowedScopes must be exactly ["api"]',
    );
  });

  it.each([
    [
      'malformed JSON',
      '{',
      'AUTH_NATIVE_APPLICATIONS must contain a valid JSON array',
    ],
    [
      'non-array JSON',
      '{}',
      'AUTH_NATIVE_APPLICATIONS must contain a JSON array',
    ],
    ['non-object entry', '[null]', 'entry at index 0: must be an object'],
    [
      'missing client id',
      JSON.stringify([{ ...VALID_APPLICATION, clientId: undefined }]),
      'clientId must be a non-empty string',
    ],
    [
      'non-string client id',
      JSON.stringify([{ ...VALID_APPLICATION, clientId: 7 }]),
      'clientId must be a non-empty string',
    ],
    [
      'empty client id',
      JSON.stringify([{ ...VALID_APPLICATION, clientId: '' }]),
      'clientId must be a non-empty string',
    ],
    [
      'blank display name',
      JSON.stringify([{ ...VALID_APPLICATION, displayName: '  ' }]),
      'displayName must be a non-empty string',
    ],
    [
      'non-string display name',
      JSON.stringify([{ ...VALID_APPLICATION, displayName: 7 }]),
      'displayName must be a non-empty string',
    ],
    [
      'unsupported client id characters',
      JSON.stringify([
        { ...VALID_APPLICATION, clientId: 'com.example/mobile' },
      ]),
      'clientId may contain only letters, numbers, periods, underscores, hyphens, and tildes',
    ],
    [
      'client id over the length limit',
      JSON.stringify([{ ...VALID_APPLICATION, clientId: 'a'.repeat(129) }]),
      'clientId must be at most 128 characters',
    ],
    [
      'web client id collision',
      JSON.stringify([{ ...VALID_APPLICATION, clientId: 'web' }]),
      'clientId is reserved for a first-party application',
    ],
    [
      'admin client id collision',
      JSON.stringify([{ ...VALID_APPLICATION, clientId: 'admin' }]),
      'clientId is reserved for a first-party application',
    ],
    [
      'duplicate client ids',
      JSON.stringify([VALID_APPLICATION, VALID_APPLICATION]),
      'clientId is duplicated',
    ],
    [
      'no redirect addresses',
      JSON.stringify([{ ...VALID_APPLICATION, redirectUris: [] }]),
      'redirectUris must contain at least one address',
    ],
    [
      'redirect addresses with the wrong type',
      JSON.stringify([
        { ...VALID_APPLICATION, redirectUris: 'example-native://callback' },
      ]),
      'redirectUris must contain at least one address',
    ],
    [
      'non-string redirect address',
      JSON.stringify([{ ...VALID_APPLICATION, redirectUris: [7] }]),
      'redirectUris[0] must be a non-empty string',
    ],
    [
      'invalid redirect address',
      JSON.stringify([
        {
          ...VALID_APPLICATION,
          redirectUris: ['http://example.com/callback'],
        },
      ]),
      'AUTH_NATIVE_APPLICATIONS entry "com.example.mobile": redirectUris[0] is not an acceptable redirect address',
    ],
    [
      'non-string scope',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: [7] }]),
      'allowedScopes[0] must be a non-empty string',
    ],
    [
      'allowed scopes with the wrong type',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: 'api' }]),
      'allowedScopes must be an array of non-empty strings',
    ],
    [
      'blank scope',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['  '] }]),
      'allowedScopes[0] must be a non-empty string',
    ],
    [
      'scope with whitespace',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['api read'] }]),
      'allowedScopes[0] must be a valid RFC 6749 scope token',
    ],
    [
      'scope with a double quote',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['api"read'] }]),
      'allowedScopes[0] must be a valid RFC 6749 scope token',
    ],
    [
      'scope with a backslash',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['api\\read'] }]),
      'allowedScopes[0] must be a valid RFC 6749 scope token',
    ],
    [
      'scope with non-ASCII characters',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['réad'] }]),
      'allowedScopes[0] must be a valid RFC 6749 scope token',
    ],
    [
      'scope with a line break',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['api\n'] }]),
      'allowedScopes[0] must be a valid RFC 6749 scope token',
    ],
    [
      'duplicate scopes',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: ['api', 'api'] }]),
      'allowedScopes[1] duplicates an earlier scope',
    ],
    [
      'unknown key',
      JSON.stringify([{ ...VALID_APPLICATION, enabled: false }]),
      'entry at index 0: unknown key "enabled"',
    ],
    [
      'misspelled scopes key',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScope: ['api'] }]),
      'entry at index 0: unknown key "allowedScope"',
    ],
    [
      'padded display name',
      JSON.stringify([{ ...VALID_APPLICATION, displayName: '  Example  ' }]),
      'displayName must not have leading or trailing whitespace',
    ],
    [
      'padded redirect address',
      JSON.stringify([
        {
          ...VALID_APPLICATION,
          redirectUris: [' com.example.mobile://oauth/callback '],
        },
      ]),
      'redirectUris[0] must not contain whitespace',
    ],
    [
      'redirect address with inner whitespace',
      JSON.stringify([
        { ...VALID_APPLICATION, redirectUris: ['com.example.mobile://a b'] },
      ]),
      'redirectUris[0] must not contain whitespace',
    ],
    [
      'duplicate redirect addresses',
      JSON.stringify([
        {
          ...VALID_APPLICATION,
          redirectUris: [
            'com.example.mobile://oauth/callback',
            'com.example.mobile://oauth/callback',
          ],
        },
      ]),
      'redirectUris[1] duplicates an earlier address',
    ],
    [
      'empty scope list',
      JSON.stringify([{ ...VALID_APPLICATION, allowedScopes: [] }]),
      'allowedScopes must contain at least one scope',
    ],
  ])('rejects %s with an entry-specific reason', (_name, raw, reason) => {
    expect(() => parseNativeApplications(raw)).toThrow(reason);
  });

  it('accepts a custom scheme outside production without the setting', () => {
    expect(
      parseNativeApplications(JSON.stringify([VALID_APPLICATION]), {
        nodeEnv: 'test',
      }),
    ).toEqual([{ ...VALID_APPLICATION, allowedScopes: ['api'] }]);
  });

  it('refuses a custom scheme in production without the setting', () => {
    expect(() =>
      parseNativeApplications(JSON.stringify([VALID_APPLICATION]), {
        nodeEnv: 'production',
      }),
    ).toThrow('redirectUris[0] is not an acceptable redirect address');
  });

  it('accepts a custom scheme in production with the setting on', () => {
    expect(
      parseNativeApplications(JSON.stringify([VALID_APPLICATION]), {
        nodeEnv: 'production',
        allowCustomScheme: true,
      }),
    ).toEqual([{ ...VALID_APPLICATION, allowedScopes: ['api'] }]);
  });

  it('keeps https and loopback http accepted in production without the setting', () => {
    expect(
      parseNativeApplications(
        JSON.stringify([
          {
            ...VALID_APPLICATION,
            redirectUris: [
              'https://client.example/callback',
              'http://127.0.0.1:5100/callback',
            ],
          },
        ]),
        { nodeEnv: 'production' },
      ),
    ).toEqual([
      {
        ...VALID_APPLICATION,
        redirectUris: [
          'https://client.example/callback',
          'http://127.0.0.1:5100/callback',
        ],
        allowedScopes: ['api'],
      },
    ]);
  });
});
