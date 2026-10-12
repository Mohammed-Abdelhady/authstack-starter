import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiReply } from '../../../auth/test/support/support';
import {
  nativeApp,
  METHODS,
  disposeNativeApps,
  recordProviderButton,
} from '../support/native-auth';
import { cleanup, press, byTestId, isShown, flush } from '../support/render';
import { deferred } from '../support/fake-engine';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(LOCALES)('native method discovery in %s', (locale) => {
  it('keeps browser sign-in usable during discovery and offers only enabled methods', async () => {
    const reply = deferred<ReturnType<typeof apiReply>>();
    const app = await nativeApp(locale, { methodsResponse: () => reply.promise });
    expect(isShown(app.root, 'native-password-choice')).toBe(false);
    expect(byTestId(app.root, 'sign-in-action').props.disabled).toBe(false);
    reply.resolve(
      apiReply({
        ...METHODS,
        capabilities: {
          password: false,
          emailLink: true,
          passkeys: false,
          registration: false,
          recovery: false,
        },
      }),
    );
    await flush();
    expect(isShown(app.root, 'native-password-choice')).toBe(false);
    expect(isShown(app.root, 'native-email-link-choice')).toBe(true);
    expect(isShown(app.root, 'native-passkey-choice')).toBe(false);
  });

  it('retains browser sign-in when the direct native catalogue is disabled', async () => {
    const app = await nativeApp(locale, { methods: { ...METHODS, nativeEnabled: false } });
    expect(isShown(app.root, 'native-password-choice')).toBe(false);
    await press(app.root, 'sign-in-action');
    expect(app.ports.authBrowser.opened).toHaveLength(1);
    const address = new URL(app.ports.authBrowser.opened[0]!.address);
    expect(address.searchParams.get('client_id')).toBe('native-client');
    expect(address.searchParams.get('redirect_uri')).toBe('sampleapp://auth/callback');
    expect(address.searchParams.get('locale')).toBe(locale);
    expect(address.searchParams.get('code_challenge_method')).toBe('S256');
    expect(app.transport.sent.some(({ path }) => path === '/api/auth/native/attempts')).toBe(false);
  });

  it('rechecks disabled direct methods while keeping browser sign-in available', async () => {
    let reads = 0;
    const held = deferred<ReturnType<typeof apiReply>>();
    const app = await nativeApp(locale, {
      methodsResponse: async () => {
        reads += 1;
        return reads === 1 ? apiReply({ ...METHODS, nativeEnabled: false }) : held.promise;
      },
    });
    await press(app.root, 'native-methods-retry');
    expect(byTestId(app.root, 'sign-in-action').props.disabled).toBe(false);
    act(() => held.resolve(apiReply(METHODS)));
    await flush();
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(byTestId(app.root, 'sign-in-action').props.disabled).toBe(false);
  });

  it('retries malformed discovery without hiding the web alternative', async () => {
    let valid = false;
    const app = await nativeApp(locale, {
      methodsResponse: async () => apiReply(valid ? METHODS : { bad: true }),
    });
    expect(byTestId(app.root, 'sign-in-action').props.disabled).toBe(false);
    valid = true;
    await press(app.root, 'native-methods-retry');
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(
      app.transport.sent.filter(({ path }) => path.startsWith('/api/auth/native/methods')),
    ).toHaveLength(2);
  });

  it('keeps the generic browser journey localized after discovery fails', async () => {
    const app = await nativeApp(locale, { methodsResponse: async () => apiReply({ bad: true }) });
    await press(app.root, 'sign-in-action');
    expect(app.ports.authBrowser.opened[0]?.address).toContain(`locale=${locale}`);
  });

  it('uses the host SDK button contract and passes a selected provider through real engine', async () => {
    const { seen, ProviderButton } = recordProviderButton();
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
        available: async () => true,
        authenticate: async ({ nonceDigest }) => ({
          kind: 'success',
          value: {
            kind: 'googleIdentityToken',
            identityToken: 'third-party-identity-token',
            nonceDigest,
          },
        }),
      },
    });
    app.reply('provider', {
      attemptId: 'ui-attempt',
      stage: 'consentRequired',
      expiresAt: app.expiresAt,
      account: { id: 'user-1', name: 'Person', email: 'person@example.test' },
      application: {
        clientId: 'native-client',
        displayName: 'Harbour',
        scopes: ['api'],
        alreadyGranted: true,
      },
    });
    expect(seen[0]?.method.mode).toBe('googleIdentityToken');
    expect(seen[0]?.locale).toBe(locale);
    await press(app.root, 'native-provider-google');
    expect(app.transport.sent.find(({ path }) => path.endsWith('/provider'))?.body).toEqual({
      kind: 'googleIdentityToken',
      identityToken: 'third-party-identity-token',
      nonceDigest: 'a'.repeat(64),
    });
    expect(isShown(app.root, 'native-consent')).toBe(true);
  });

  it('preserves configured providers when the native module is unavailable and opens the selected system journey', async () => {
    const app = await nativeApp(locale, {
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
    });
    await press(app.root, 'native-provider-google');
    expect(app.ports.authBrowser.opened).toHaveLength(1);
    expect(app.ports.authBrowser.opened[0]?.address).toContain('provider_id=google');
    expect(app.transport.sent.some(({ path }) => path.endsWith('/provider'))).toBe(false);
    expect(app.ports.authBrowser.opened[0]?.address).toContain(`locale=${locale}`);
    expect(app.transport.sent.some(({ path }) => path === '/api/auth/native/attempts')).toBe(false);
  });
});

describe('native passkey cancellation', () => {
  it('returns to the available method choices after the platform prompt is cancelled', async () => {
    const app = await nativeApp();
    app.reply('passkey/options', {
      challenge: 'credential-challenge',
      rpId: 'example.test',
      userVerification: 'required',
    });
    await press(app.root, 'native-passkey-choice');
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(app.transport.sent.some(({ path }) => path.endsWith('/passkey/verify'))).toBe(false);
  });
});
