import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiReply } from '../../../auth/test/support/support';
import { nativeApp, disposeNativeApps, ATTEMPT_ID, ATTEMPT_SECRET } from '../support/native-auth';
import { cleanup, press, byTestId, flush, isShown, unmountAll } from '../support/render';
import { deferred } from '../support/fake-engine';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe('native pending actions', () => {
  it('sends one password request for repeated submits, clears its secret, and ignores its reply after cancellation', async () => {
    const app = await nativeApp();
    const held = deferred<unknown>();
    app.handle('password', () => held.promise);
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    await press(app.root, 'native-submit');
    expect(app.transport.sent.filter(({ path }) => path.endsWith('/password'))).toHaveLength(1);
    expect(byTestId(app.root, 'native-password').props.value).toBe('');
    await press(app.root, 'native-cancel');
    act(() =>
      held.resolve({
        attemptId: ATTEMPT_ID,
        stage: 'consentRequired',
        expiresAt: app.expiresAt,
        account: { id: 'user-1', name: 'Person', email: 'person@example.test' },
        application: {
          clientId: 'native-client',
          displayName: 'Harbour',
          scopes: ['api'],
          alreadyGranted: false,
        },
      }),
    );
    await flush();
    expect(isShown(app.root, 'native-consent')).toBe(false);
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(app.ports.credentials.value).toBeUndefined();
  });

  it('releases the old pending UI action when the host replaces its engine', async () => {
    const app = await nativeApp();
    const held = deferred<unknown>();
    app.handle('password', () => held.promise);
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    await app.replaceEngine();
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(byTestId(app.root, 'native-password-choice').props.disabled).toBe(false);
    act(() =>
      held.resolve({
        attemptId: ATTEMPT_ID,
        stage: 'secondFactorRequired',
        expiresAt: app.expiresAt,
        factors: ['totp'],
      }),
    );
    await flush();
    expect(isShown(app.root, 'native-totp-choice')).toBe(false);
  });

  it('cancels only once while secure deletion is pending', async () => {
    const app = await nativeApp();
    await press(app.root, 'native-password-choice');
    const held = deferred<void>();
    app.ports.credentials.beforeDelete = () => held.promise;
    await press(app.root, 'native-cancel');
    await press(app.root, 'native-cancel');
    expect(app.ports.credentials.events.filter((event) => event === 'delete:start')).toHaveLength(
      1,
    );
    act(() => held.resolve());
    await flush();
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
  });

  it('does not launch a platform prompt from a delayed start after UI unmount', async () => {
    let prompts = 0;
    const app = await nativeApp('en', {
      passkeys: {
        available: async () => true,
        authenticate: async () => {
          prompts += 1;
          return { kind: 'cancelled' };
        },
      },
    });
    const held = deferred<ReturnType<typeof apiReply>>();
    app.raw('/api/auth/native/attempts', () => held.promise);
    await press(app.root, 'native-passkey-choice');
    unmountAll();
    held.resolve(
      apiReply({
        attemptId: ATTEMPT_ID,
        attemptSecret: ATTEMPT_SECRET,
        providerNonceDigest: 'a'.repeat(64),
        stage: 'firstFactorRequired',
        expiresAt: app.expiresAt,
        factors: ['passkey'],
      }),
    );
    await flush();
    expect(prompts).toBe(0);
    expect(app.transport.sent.some(({ path }) => path.endsWith('/passkey/options'))).toBe(false);
  });
});

describe('native discovery replacement', () => {
  it('discards a previous engine discovery after the current engine has answered', async () => {
    const held = deferred<ReturnType<typeof apiReply>>();
    let requests = 0;
    const app = await nativeApp('en', {
      methodsResponse: async () => {
        requests += 1;
        return requests === 1
          ? held.promise
          : apiReply({
              nativeEnabled: true,
              methods: {
                password: false,
                magicLink: true,
                passkeys: false,
                twoFactor: false,
                oauth: [],
              },
              capabilities: {
                password: false,
                emailLink: true,
                passkeys: false,
                registration: false,
                recovery: false,
              },
              providers: [],
            });
      },
    });
    await app.replaceEngine();
    expect(requests).toBe(2);
    expect(isShown(app.root, 'native-email-link-choice')).toBe(true);
    act(() =>
      held.resolve(
        apiReply({
          nativeEnabled: true,
          methods: {
            password: true,
            magicLink: false,
            passkeys: false,
            twoFactor: false,
            oauth: [],
          },
          capabilities: {
            password: true,
            emailLink: false,
            passkeys: false,
            registration: true,
            recovery: true,
          },
          providers: [],
        }),
      ),
    );
    await flush();
    expect(isShown(app.root, 'native-password-choice')).toBe(false);
    expect(isShown(app.root, 'native-email-link-choice')).toBe(true);
  });
});
