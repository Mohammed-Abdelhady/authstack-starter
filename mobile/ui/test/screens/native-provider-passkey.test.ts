import type {
  NativeProviderMethod,
  NativeProviderCredential,
  NativePasskeyAssertion,
} from '@app/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nativeApp,
  disposeNativeApps,
  ATTEMPT_ID,
  METHODS,
  recordProviderButton,
} from '../support/native-auth';
import { cleanup, press, isShown } from '../support/render';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});
const SDK_CASES: readonly {
  method: NativeProviderMethod;
  credential: NativeProviderCredential;
  host: boolean;
}[] = [
  {
    method: {
      id: 'apple',
      displayName: 'Apple',
      mode: 'appleIdentityTokenAndCode',
      sdk: { kind: 'apple', appId: 'public-app' },
    },
    credential: {
      kind: 'appleIdentityTokenAndCode',
      identityToken: 'apple-token',
      authorizationCode: 'apple-code',
      nonceDigest: 'a'.repeat(64),
    },
    host: true,
  },
  {
    method: {
      id: 'facebook',
      displayName: 'Facebook',
      mode: 'facebook',
      sdk: { kind: 'facebook', appId: 'public-app' },
    },
    credential: { kind: 'facebookAccessToken', accessToken: 'facebook-token' },
    host: false,
  },
];
const ASSERTION: NativePasskeyAssertion = {
  id: 'credential',
  rawId: 'credential',
  type: 'public-key',
  clientExtensionResults: {},
  response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
};

function consent(expiresAt: string) {
  return {
    attemptId: ATTEMPT_ID,
    stage: 'consentRequired',
    expiresAt,
    account: { id: 'user-1', name: 'Person', email: 'person@example.test' },
    application: {
      clientId: 'native-client',
      displayName: 'Harbour',
      scopes: ['api'],
      alreadyGranted: false,
    },
  };
}

describe.each(['en'] as const)('native credential mode matrix in %s', (locale) => {
  it.each(SDK_CASES)(
    'passes the $method.id proof through the real engine and correct button consumer',
    async ({ method, credential, host }) => {
      const { seen, ProviderButton } = recordProviderButton();
      const app = await nativeApp(locale, {
        providerButton: ProviderButton,
        methods: {
          ...METHODS,
          methods: {
            ...METHODS.methods,
            oauth: [{ id: method.id, displayName: method.displayName }],
          },
          providers: [method],
        },
        providerSignIn: {
          available: async () => true,
          authenticate: async () => ({ kind: 'success', value: credential }),
        },
      });
      app.reply('provider', consent(app.expiresAt));
      expect(seen.length > 0).toBe(host);
      await press(app.root, `native-provider-${method.id}`);
      expect(app.transport.sent.find(({ path }) => path.endsWith('/provider'))?.body).toEqual(
        credential,
      );
      expect(isShown(app.root, 'native-consent')).toBe(true);
    },
  );

  it('uses the browser honestly when an available Apple SDK has no host renderer', async () => {
    const method: NativeProviderMethod = {
      id: 'apple',
      displayName: 'Apple',
      mode: 'appleIdentityTokenAndCode',
      sdk: { kind: 'apple', appId: 'public-app' },
    };
    const app = await nativeApp(locale, {
      methods: {
        ...METHODS,
        methods: { ...METHODS.methods, oauth: [{ id: 'apple', displayName: 'Apple' }] },
        providers: [method],
      },
      providerSignIn: {
        available: async () => true,
        authenticate: async () => {
          throw new Error('No SDK prompt without renderer');
        },
      },
    });
    await press(app.root, 'native-provider-apple');
    expect(app.ports.authBrowser.opened[0]?.address).toContain('provider_id=apple');
    expect(app.ports.authBrowser.opened[0]?.address).toContain(`locale=${locale}`);
    expect(app.transport.sent.some(({ path }) => path === '/api/auth/native/attempts')).toBe(false);
  });

  it.each([false, true])(
    'passes a successful native passkey to the correct MFA=%s HTTP boundary',
    async (mfa) => {
      const app = await nativeApp(locale, {
        passkeys: {
          available: async () => true,
          authenticate: async () => ({ kind: 'success', value: ASSERTION }),
        },
      });
      app.reply('passkey/options', {
        challenge: 'credential-challenge',
        rpId: 'example.test',
        userVerification: 'required',
      });
      app.reply('passkey/verify', consent(app.expiresAt));
      app.reply('second-factor', consent(app.expiresAt));
      if (mfa) {
        app.reply('password', {
          attemptId: ATTEMPT_ID,
          stage: 'secondFactorRequired',
          expiresAt: app.expiresAt,
          factors: ['passkey'],
        });
        await press(app.root, 'native-password-choice');
        await app.input('native-email', 'person@example.test');
        await app.input('native-password', 'Temporary-secret1');
        await press(app.root, 'native-submit');
      }
      await press(app.root, 'native-passkey-choice');
      expect(
        app.transport.sent.find(({ path }) =>
          path.endsWith(mfa ? '/second-factor' : '/passkey/verify'),
        )?.body,
      ).toEqual(mfa ? { passkeyResponse: ASSERTION } : { response: ASSERTION });
      expect(isShown(app.root, 'native-consent')).toBe(true);
    },
  );
});

describe.each(LOCALES)('native SDK capability changes in %s', (locale) => {
  it('passes the UI locale through the real engine SDK-to-system downgrade', async () => {
    let checks = 0;
    const { ProviderButton } = recordProviderButton();
    const app = await nativeApp(locale, {
      providerButton: ProviderButton,
      methods: {
        ...METHODS,
        methods: { ...METHODS.methods, oauth: [{ id: 'google', displayName: 'Google' }] },
        providers: [
          {
            id: 'google',
            displayName: 'Google',
            mode: 'googleIdentityToken',
            sdk: { kind: 'google', webClientId: 'public-client' },
          },
        ],
      },
      providerSignIn: {
        available: async () => {
          checks += 1;
          return checks === 1;
        },
        authenticate: async () => {
          throw new Error('SDK became unavailable');
        },
      },
    });
    await press(app.root, 'native-provider-google');
    expect(app.ports.authBrowser.opened[0]?.address).toContain('provider_id=google');
    expect(app.ports.authBrowser.opened[0]?.address).toContain(`locale=${locale}`);
    expect(app.transport.sent.some(({ path }) => path.endsWith('/provider'))).toBe(false);
  });
});
