import {
  AuthDisposedError,
  AuthPortError,
  AuthSessionError,
  CredentialStoreError,
  DeviceBindingRequiredError,
  DeviceKeyAuthError,
  UnsafeRequestPathError,
  type RefreshOutcome,
  type RestoreOutcome,
  type SignInOutcome,
  type SignOutOutcome,
} from '@app/native-auth';
import { ApiError, OAuthError, TransportError } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { MESSAGES, type MessageKey } from '../src/i18n/messages';
import {
  describeAction,
  describeError,
  describeProfile,
  describeRefresh,
  describeRestore,
  describeSignIn,
  describeSignOut,
  render,
  type Described,
} from '../src/logic/outcome-text';

const PROFILE = {
  id: 'user-1',
  email: 'person@example.test',
  name: 'Test Person',
  role: 'user',
  permissions: [],
  authProvider: 'password',
  isVerified: true,
  twoFactorEnabled: false, // feature:totp
  passkeyCount: 0, // feature:passkeys
  linkedProviders: [],
};
const FAILURE = new Error('failed');
const OAUTH = new OAuthError({ status: 400, error: 'invalid_grant' });
const API = new ApiError({ status: 403, code: 'FORBIDDEN', message: 'No access' });
const LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;

type Samples<T extends { kind: string }> = {
  [K in T['kind']]: { outcome: Extract<T, { kind: K }>; key: MessageKey; outsideData?: true };
};

/** One outcome of every kind, with the catalogue key its line opens with. A new kind fails to compile. */
const RESTORE: Samples<RestoreOutcome> = {
  disposed: { outcome: { kind: 'disposed' }, key: 'engineDisposed' },
  restored: { outcome: { kind: 'restored', status: 'signedIn' }, key: 'restoreRestored' },
  storageBlocked: {
    outcome: { kind: 'storageBlocked', reason: 'locked' },
    key: 'restoreStorageBlocked',
  },
};

const SIGN_IN: Samples<SignInOutcome> = {
  disposed: { outcome: { kind: 'disposed' }, key: 'engineDisposed' },
  signedIn: { outcome: { kind: 'signedIn', profile: PROFILE }, key: 'statusSignedIn' },
  alreadySignedIn: { outcome: { kind: 'alreadySignedIn' }, key: 'signInAlreadySignedIn' },
  signedOut: { outcome: { kind: 'signedOut' }, key: 'signInSignedOut' },
  cancelled: { outcome: { kind: 'cancelled' }, key: 'signInCancelled' },
  dismissed: { outcome: { kind: 'dismissed' }, key: 'signInDismissed' },
  expired: { outcome: { kind: 'expired' }, key: 'signInExpired' },
  cryptoFailure: {
    outcome: { kind: 'cryptoFailure', error: FAILURE },
    key: 'signInCryptoFailure',
    outsideData: true,
  },
  clockFailure: {
    outcome: { kind: 'clockFailure', error: FAILURE },
    key: 'signInClockFailure',
    outsideData: true,
  },
  browserFailure: {
    outcome: { kind: 'browserFailure', reason: 'browserLocked' },
    key: 'signInBrowserFailure',
  },
  authorizationDenied: {
    outcome: { kind: 'authorizationDenied', error: 'access_denied' },
    key: 'signInAuthorizationDenied',
    outsideData: true,
  },
  invalidCallback: {
    outcome: { kind: 'invalidCallback', reason: 'stateMismatch' },
    key: 'signInInvalidCallback',
  },
  disabled: { outcome: { kind: 'disabled' }, key: 'reasonDisabled' },
  deviceBindingRequired: {
    outcome: { kind: 'deviceBindingRequired' },
    key: 'reasonDeviceBindingRequired',
  },
  deviceKeyFailure: {
    outcome: { kind: 'deviceKeyFailure', reason: 'cancelled' },
    key: 'signInDeviceKeyFailure',
  },
  oauthFailure: {
    outcome: { kind: 'oauthFailure', error: OAUTH },
    key: 'signInOauthFailure',
    outsideData: true,
  },
  throttled: {
    outcome: { kind: 'throttled', error: API },
    key: 'signInThrottled',
    outsideData: true,
  },
  transportFailure: {
    outcome: { kind: 'transportFailure', error: new TransportError('no_response') },
    key: 'signInTransportFailure',
  },
  aborted: {
    outcome: { kind: 'aborted', error: new TransportError('aborted') },
    key: 'signInAborted',
  },
  apiFailure: {
    outcome: { kind: 'apiFailure', error: API },
    key: 'signInApiFailure',
    outsideData: true,
  },
  storageFailure: {
    outcome: {
      kind: 'storageFailure',
      error: new CredentialStoreError('credentials.replace', 'locked'),
    },
    key: 'signInStorageFailure',
  },
};

const REFRESH: Samples<RefreshOutcome> = {
  disposed: { outcome: { kind: 'disposed' }, key: 'engineDisposed' },
  refreshed: { outcome: { kind: 'refreshed' }, key: 'refreshRefreshed' },
  notSignedIn: { outcome: { kind: 'notSignedIn' }, key: 'refreshNotSignedIn' },
  failed: {
    outcome: { kind: 'failed', error: new AuthPortError('credentials.read', 'timedOut') },
    key: 'refreshFailed',
  },
};

const SIGN_OUT: Samples<SignOutOutcome> = {
  disposed: { outcome: { kind: 'disposed' }, key: 'engineDisposed' },
  signedOut: { outcome: { kind: 'signedOut', revocation: 'revoked' }, key: 'signOutSignedOut' },
  signOutNotSaved: { outcome: { kind: 'signOutNotSaved' }, key: 'reasonStorageFailure' },
};

interface Line {
  name: string;
  line: Described;
  key: MessageKey;
  outsideData: boolean;
}

function lines<T extends { kind: string }>(
  action: 'restore' | 'signIn' | 'refresh' | 'signOut',
  samples: Samples<T>,
  describeOutcome: (outcome: T) => Described,
): Line[] {
  const entries: { outcome: T; key: MessageKey; outsideData?: true }[] = Object.values(samples);
  return entries.map(({ outcome, key, outsideData }) => ({
    name: `${action} ${outcome.kind}`,
    line: describeAction(action, describeOutcome(outcome)),
    key,
    outsideData: outsideData === true,
  }));
}

const EVERY_OUTCOME: Line[] = [
  ...lines('restore', RESTORE, describeRestore),
  ...lines('signIn', SIGN_IN, describeSignIn),
  ...lines('refresh', REFRESH, describeRefresh),
  ...lines('signOut', SIGN_OUT, describeSignOut),
];

const ACTION_KEYS: Record<string, MessageKey> = {
  restore: 'actionRestore',
  signIn: 'actionSignIn',
  refresh: 'actionRefresh',
  signOut: 'actionSignOut',
};

describe('every outcome of every action', () => {
  it('covers the 31 outcome kinds the engine can return', () => {
    expect(EVERY_OUTCOME).toHaveLength(31);
  });

  it.each(EVERY_OUTCOME)('reads $name from the catalogue', ({ name, line, key }) => {
    const [action = ''] = name.split(' ');

    expect(line.key).toBe(ACTION_KEYS[action]);
    expect(typeof line.value === 'object' ? line.value.key : undefined).toBe(key);
    for (const locale of LOCALES) {
      const text = render(locale, line);

      expect(MESSAGES[locale][key].trim()).not.toBe('');
      expect(text).not.toMatch(/\{(?:value|detail)\}/);
      expect(text.startsWith(MESSAGES[locale][line.key].split('{value}')[0] ?? '')).toBe(true);
    }
  });

  // feature:locale-ar:start
  it.each(EVERY_OUTCOME.filter(({ outsideData }) => !outsideData))(
    'shows $name in Arabic with no raw identifier or English word',
    ({ line }) => {
      expect(render('ar', line)).not.toMatch(/[A-Za-z]/);
    },
  );
  // feature:locale-ar:end
});

describe('the detail of an outcome', () => {
  it('names where restore ended and why it was blocked', () => {
    expect(describeRestore({ kind: 'restored', status: 'reauthRequired' }).value).toEqual({
      key: 'statusReauthRequired',
    });
    expect(describeRestore({ kind: 'storageBlocked', reason: 'installUnavailable' }).value).toEqual(
      { key: 'blockInstallUnavailable' },
    );
  });

  it.each([
    ['browserLocked', { key: 'browserLocked' }],
    ['redirectWithoutAddress', { key: 'browserRedirectWithoutAddress' }],
    ['unexpectedResult:opened', { key: 'browserUnexpectedResult' }],
    ['unknown', { key: 'browserUnknown' }],
    ['ERR_WEB_BROWSER', { key: 'browserOther', value: 'ERR_WEB_BROWSER' }],
  ])('reads the browser reason %s', (reason, expected) => {
    expect(describeSignIn({ kind: 'browserFailure', reason }).value).toEqual(expected);
  });

  it('keeps a server code as data inside a catalogue sentence', () => {
    expect(describeSignIn({ kind: 'authorizationDenied', error: 'access_denied' }).value).toBe(
      'access_denied',
    );
    expect(describeSignIn({ kind: 'oauthFailure', error: OAUTH }).value).toEqual({
      key: 'errorOAuth',
      value: '400 invalid_grant',
    });
  });

  it('reads the reason of a rejected link and of a failed device key', () => {
    expect(describeSignIn({ kind: 'invalidCallback', reason: 'fragment' }).value).toEqual({
      key: 'callbackFragment',
    });
    expect(
      describeSignIn({ kind: 'deviceKeyFailure', reason: 'thumbprintMismatch' }).value,
    ).toEqual({ key: 'keyThumbprintMismatch' });
  });

  it.each([
    ['notNeeded', 'revocationNotNeeded'],
    ['recordUnavailable', 'revocationRecordUnavailable'],
    ['revoked', 'revocationRevoked'],
    ['failed', 'revocationFailed'],
    ['timedOut', 'revocationTimedOut'],
  ] as const)('reads the revocation result %s', (revocation, key) => {
    expect(describeSignOut({ kind: 'signedOut', revocation })).toEqual({
      key: 'signOutSignedOut',
      value: { key },
    });
  });

  it('adds the error a sign-out carries', () => {
    expect(
      describeSignOut({ kind: 'signedOut', revocation: 'failed', error: new TransportError() }),
    ).toEqual({
      key: 'signOutSignedOutWithError',
      value: { key: 'revocationFailed' },
      detail: { key: 'errorNoResponse' },
    });
  });

  it('says which write the store refused and why, so a locked device reads as locked', () => {
    const locked = new CredentialStoreError('credentials.replace', 'locked');

    expect(describeRefresh({ kind: 'failed', error: locked })).toEqual({
      key: 'refreshFailed',
      value: {
        key: 'errorStore',
        value: { key: 'portCredentialsReplace' },
        detail: { key: 'blockLocked' },
      },
    });
  });

  it('shows the account a loaded profile belongs to', () => {
    expect(describeProfile('person@example.test')).toEqual({
      key: 'profileLoaded',
      value: 'person@example.test',
    });
  });
});

describe('an error a request rejects with', () => {
  it.each<[string, unknown, Described]>([
    ['a server error', API, { key: 'errorApi', value: '403 FORBIDDEN' }],
    ['no response', new TransportError('no_response'), { key: 'errorNoResponse' }],
    ['an abort', new TransportError('aborted'), { key: 'errorAborted' }],
    [
      'a port past its deadline',
      new AuthPortError('credentials.read', 'timedOut'),
      { key: 'errorPortTimedOut', value: { key: 'portCredentialsRead' } },
    ],
    [
      'a port the catalogue does not name',
      new AuthPortError('timer.after', 'failed'),
      { key: 'errorPortFailed', value: { key: 'portOther' } },
    ],
    [
      'a device key failure',
      new DeviceKeyAuthError('keyInvalidated'),
      { key: 'signInDeviceKeyFailure', value: { key: 'reasonDeviceKeyInvalidated' } },
    ],
    [
      'a required device key',
      new DeviceBindingRequiredError('NATIVE_DPOP_REQUIRED'),
      { key: 'reasonDeviceBindingRequired' },
    ],
    ['no session', new AuthSessionError(), { key: 'errorSession' }],
    ['a disposed engine', new AuthDisposedError(), { key: 'engineDisposed' }],
    ['an unsafe path', new UnsafeRequestPathError(), { key: 'errorUnsafePath' }],
    ['another error', new RangeError('too large'), { key: 'errorUnexpected', value: 'RangeError' }],
    ['a thrown value that is no error', 'text', { key: 'errorUnknown' }],
  ])('describes %s', (_name, error, expected) => {
    expect(describeError(error)).toEqual(expected);
  });

  it.each(LOCALES)('never prints the message an error carries, in %s', (locale) => {
    const text = render(locale, describeError(new RangeError('too large')));

    expect(text).not.toContain('too large');
    expect(text).toContain('RangeError');
  });
});
