import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, press, byTestId, isShown, flush } from '../support/render';
import { nativeApp, disposeNativeApps, ATTEMPT_ID } from '../support/native-auth';
import { deferred } from '../support/fake-engine';
import { act } from 'react';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(LOCALES)('native credential handoff in %s', (locale) => {
  it('submits the field values through real engine/SDK and clears the password before a reply', async () => {
    const app = await nativeApp(locale);
    const response = deferred<unknown>();
    app.handle('password', () => response.promise);
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    expect(app.transport.sent.find(({ path }) => path.endsWith('/password'))?.body).toEqual({
      email: 'person@example.test',
      password: 'Temporary-secret1',
    });
    expect(byTestId(app.root, 'native-password').props.value).toBe('');
    act(() =>
      response.resolve({
        attemptId: ATTEMPT_ID,
        stage: 'secondFactorRequired',
        expiresAt: app.expiresAt,
        factors: ['totp'],
      }),
    );
    await flush();
    await press(app.root, 'native-totp-choice');
    expect(isShown(app.root, 'native-code')).toBe(true);
    expect(app.ports.credentials.value).not.toContain('Temporary-secret1');
  });

  it('requires a human to submit real verified consent', async () => {
    const app = await nativeApp(locale);
    app.reply('password', {
      attemptId: ATTEMPT_ID,
      stage: 'consentRequired',
      expiresAt: app.expiresAt,
      account: { id: 'user-1', email: 'person@example.test', name: 'Person' },
      application: {
        clientId: 'native-client',
        displayName: 'Harbour',
        scopes: ['api'],
        alreadyGranted: false,
      },
    });
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    expect(isShown(app.root, 'native-consent')).toBe(true);
    expect(
      app.transport.sent.some(
        ({ path }) => path.endsWith('/consent') || path === '/api/oauth/token',
      ),
    ).toBe(false);
    expect(byTestId(app.root, 'native-consent-accept').props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
  });
});

describe('native credential controls', () => {
  it('does not submit empty or invalid fields and preserves exact password bytes on keyboard submit', async () => {
    const app = await nativeApp();
    app.reply('password', {
      attemptId: ATTEMPT_ID,
      stage: 'secondFactorRequired',
      expiresAt: app.expiresAt,
      factors: ['totp'],
    });
    await press(app.root, 'native-password-choice');
    await press(app.root, 'native-submit');
    await app.input('native-email', 'invalid');
    await app.input('native-password', '   ');
    await press(app.root, 'native-submit');
    expect(app.transport.sent.some(({ path }) => path.endsWith('/password'))).toBe(false);
    await app.input('native-email', '  person@example.test  ');
    await app.input('native-password', '  Exact-password1  ');
    const submit = byTestId(app.root, 'native-password').props.onSubmitEditing;
    if (typeof submit !== 'function') throw new Error('No keyboard submission');
    act(() => submit());
    await flush();
    expect(app.transport.sent.find(({ path }) => path.endsWith('/password'))?.body).toEqual({
      email: 'person@example.test',
      password: '  Exact-password1  ',
    });
  });

  it('clears credentials when changing method and exposes the autofill/accessibility contract', async () => {
    const app = await nativeApp();
    await press(app.root, 'native-password-choice');
    expect(byTestId(app.root, 'native-password').props.autoComplete).toBe('current-password');
    expect(byTestId(app.root, 'native-password').props.secureTextEntry).toBe(true);
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-password-visibility');
    expect(byTestId(app.root, 'native-password').props.secureTextEntry).toBe(false);
    expect(app.transport.sent.some(({ path }) => path.endsWith('/password'))).toBe(false);
    await press(app.root, 'native-cancel');
    await press(app.root, 'native-password-choice');
    expect(byTestId(app.root, 'native-password').props.value).toBe('');
    expect(byTestId(app.root, 'native-password').props.secureTextEntry).toBe(true);
  });
});
