import { AuthPortError, CredentialStoreError } from '@app/native-auth';
import { ApiError, OAuthError, TransportError } from '@app/sdk';
import { SERVER_USER } from '@app/native-adapters/testing';
import { describe, expect, it } from 'vitest';
import { DIRECTION, LOCALES, MESSAGES, translate, type MessageKey } from '../src/i18n/messages';
import {
  describeError,
  describeRestore,
  describeSignIn,
  describeSignOut,
  describeRefresh,
  render,
  type Described,
} from '../src/logic/outcome-text';
import { resolveConfig, resolveKeyProtection } from '../src/logic/resolve-config';
import typescriptConfig from '../tsconfig.json';

describe('app configuration', () => {
  it('already extends the Expo base, so starting the app rewrites no tracked file', () => {
    // Expo adds this line to any config without it, each time the app starts.
    expect(typescriptConfig).toMatchObject({ extends: 'expo/tsconfig.base' });
  });

  it('points a development build at the local server when no origin is set', () => {
    expect(
      resolveConfig({ apiOrigin: undefined, development: true, scheme: 'com.example.mobile' }),
    ).toEqual({
      serverBaseAddress: 'http://localhost:5001',
      environment: 'development',
      clientId: 'com.example.mobile',
      redirectUri: 'com.example.mobile://oauth/callback',
      scopes: ['api'],
    });
  });

  it('builds the client id and the return address from another scheme', () => {
    const config = resolveConfig({
      apiOrigin: undefined,
      development: true,
      scheme: 'org.sample.notes',
    });

    expect(config.clientId).toBe('org.sample.notes');
    expect(config.redirectUri).toBe('org.sample.notes://oauth/callback');
  });

  it.each([[''], ['   ']])('treats the origin %j as not set', (apiOrigin) => {
    expect(
      resolveConfig({ apiOrigin, development: true, scheme: 'com.example.mobile' })
        .serverBaseAddress,
    ).toBe('http://localhost:5001');
  });

  it('uses the configured origin, trimmed', () => {
    const config = resolveConfig({
      apiOrigin: ' https://api.example.test ',
      development: false,
      scheme: 'com.example.mobile',
    });

    expect(config.serverBaseAddress).toBe('https://api.example.test');
    expect(config.environment).toBe('production');
  });

  it('refuses to start a release build with no origin', () => {
    expect(() =>
      resolveConfig({ apiOrigin: undefined, development: false, scheme: 'com.example.mobile' }),
    ).toThrow('EXPO_PUBLIC_API_ORIGIN is not set.');
  });

  it('lets only a development build sign with a software key', () => {
    expect(resolveKeyProtection(true)).toBe('softwareAllowed');
    expect(resolveKeyProtection(false)).toBe('hardwareOnly');
  });
});

describe('messages', () => {
  // feature:locale-ar:start
  const keys = Object.keys(MESSAGES.en).filter((key): key is MessageKey => key in MESSAGES.en);

  it('has every key in both languages, each taking a value or not in both', () => {
    expect(Object.keys(MESSAGES.ar).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(MESSAGES.ar[key].trim()).not.toBe('');
      expect(MESSAGES.ar[key].includes('{value}'), key).toBe(MESSAGES.en[key].includes('{value}'));
      expect(MESSAGES.ar[key].includes('{detail}'), key).toBe(
        MESSAGES.en[key].includes('{detail}'),
      );
      expect(MESSAGES.ar[key].replace(/\{(?:value|detail)\}/g, ''), key).not.toMatch(/[A-Za-z]/);
    }
  });
  // feature:locale-ar:end

  it('includes startup, device key, and token request messages in every catalogue', () => {
    const addedKeys: MessageKey[] = [
      'starting',
      'startFailed',
      'deviceKey',
      'deviceKeySecureEnclave',
      'deviceKeyStrongBox',
      'deviceKeyTrustedEnvironment',
      'deviceKeySoftware',
      'deviceKeyNoSecureHardware',
      'deviceKeyUnavailable',
      'deviceKeyInvalidated',
      'refreshTokenRequests',
    ];
    for (const locale of LOCALES) {
      for (const key of addedKeys) {
        expect(MESSAGES[locale][key], key).toBeDefined();
        expect(MESSAGES[locale][key].trim(), key).not.toBe('');
      }
    }
  });

  it('lays each language out in its own direction', () => {
    expect(DIRECTION).toEqual({
      en: 'ltr',
      ar: 'rtl', // feature:locale-ar
    });
  });

  it('puts the value into the message as it is', () => {
    for (const locale of LOCALES) {
      const text = translate(locale, 'status', 'a$&b');

      expect(text).toContain('a$&b');
      expect(text).not.toContain('{value}');
      expect(text.length).toBe(MESSAGES[locale].status.length - '{value}'.length + 'a$&b'.length);
    }
  });

  it('puts a second part into a message that takes one', () => {
    const text = translate('en', 'signOutSignedOutWithError', 'first', 'second');

    expect(text).toBe('signed out, first, second');
  });

  it.each(LOCALES)('returns a message without a value unchanged in %s', (locale) => {
    expect(translate(locale, 'signIn')).toBe(MESSAGES[locale].signIn);
  });
});

describe.each(LOCALES)('incoming outcome cases in %s', (locale) => {
  const cases: [Described, MessageKey, string?, string?][] = [
    [
      describeRestore({ kind: 'restored', status: 'signedIn' }),
      'restoreRestored',
      MESSAGES[locale].statusSignedIn,
    ],
    [
      describeRestore({ kind: 'storageBlocked', reason: 'locked' }),
      'restoreStorageBlocked',
      MESSAGES[locale].blockLocked,
    ],
    [describeSignIn({ kind: 'signedIn', profile: SERVER_USER }), 'statusSignedIn'],
    [describeSignIn({ kind: 'cancelled' }), 'signInCancelled'],
    [describeSignIn({ kind: 'disposed' }), 'engineDisposed'],
    [
      describeSignIn({ kind: 'browserFailure', reason: 'browserLocked' }),
      'signInBrowserFailure',
      MESSAGES[locale].browserLocked,
    ],
    [
      describeSignIn({ kind: 'invalidCallback', reason: 'stateMismatch' }),
      'signInInvalidCallback',
      MESSAGES[locale].callbackStateMismatch,
    ],
    [
      describeSignIn({ kind: 'authorizationDenied', error: 'access_denied' }),
      'signInAuthorizationDenied',
      '\u2066access_denied\u2069',
    ],
    [
      describeSignOut({ kind: 'signedOut', revocation: 'revoked' }),
      'signOutSignedOut',
      MESSAGES[locale].revocationRevoked,
    ],
    [describeRefresh({ kind: 'refreshed' }), 'refreshRefreshed'],
    [describeRefresh({ kind: 'notSignedIn' }), 'refreshNotSignedIn'],
  ];

  it.each(cases)('describes %# through the catalogue', (described, key, value, detail) => {
    expect(render(locale, described)).toBe(translate(locale, key, value, detail));
  });

  it('names the error an outcome carries', () => {
    const oauth = new OAuthError({ status: 400, error: 'invalid_grant' });
    expect(render(locale, describeSignIn({ kind: 'oauthFailure', error: oauth }))).toBe(
      translate(
        locale,
        'signInOauthFailure',
        translate(locale, 'errorOAuth', '\u2066400 invalid_grant\u2069'),
      ),
    );
    expect(
      render(
        locale,
        describeSignOut({ kind: 'signedOut', revocation: 'failed', error: new TransportError() }),
      ),
    ).toBe(
      translate(
        locale,
        'signOutSignedOutWithError',
        MESSAGES[locale].revocationFailed,
        MESSAGES[locale].errorNoResponse,
      ),
    );
  });

  it('says why the store refused a write', () => {
    const locked = new CredentialStoreError('credentials.replace', 'locked');
    const expected = translate(
      locale,
      'errorStore',
      MESSAGES[locale].portCredentialsReplace,
      MESSAGES[locale].blockLocked,
    );
    expect(render(locale, describeError(locked))).toBe(expected);
    expect(render(locale, describeRefresh({ kind: 'failed', error: locked }))).toBe(
      translate(locale, 'refreshFailed', expected),
    );
  });

  it('describes each error a request can reject with', () => {
    const api = new ApiError({ status: 403, code: 'FORBIDDEN', message: 'No access' });
    expect(render(locale, describeError(api))).toBe(
      translate(locale, 'errorApi', '\u2066403 FORBIDDEN\u2069'),
    );
    expect(render(locale, describeError(new AuthPortError('credentials.read', 'timedOut')))).toBe(
      translate(locale, 'errorPortTimedOut', MESSAGES[locale].portCredentialsRead),
    );
    expect(render(locale, describeError(new RangeError('too large')))).toBe(
      translate(locale, 'errorUnexpected', '\u2066RangeError\u2069'),
    );
    expect(render(locale, describeError('text'))).toBe(MESSAGES[locale].errorUnknown);
  });
});
