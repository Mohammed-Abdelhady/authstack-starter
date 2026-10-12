import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeApp, disposeNativeApps, ATTEMPT_ID } from '../support/native-auth';
import { cleanup, press, isShown, byTestId } from '../support/render';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(LOCALES)('native MFA readiness in %s', (locale) => {
  it('discards the text code when selecting a passkey, including a cancelled prompt', async () => {
    const app = await nativeApp(locale);
    app.reply('password', {
      attemptId: ATTEMPT_ID,
      stage: 'secondFactorRequired',
      expiresAt: app.expiresAt,
      factors: ['totp', 'passkey'],
    });
    app.reply('passkey/options', {
      challenge: 'credential-challenge',
      rpId: 'example.test',
      userVerification: 'required',
    });
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    await press(app.root, 'native-totp-choice');
    await app.input('native-code', '123456');
    await press(app.root, 'native-passkey-choice');
    expect(isShown(app.root, 'native-code')).toBe(false);
    await press(app.root, 'native-totp-choice');
    expect(byTestId(app.root, 'native-code').props.value).toBe('');
    expect(app.transport.sent.some(({ path }) => path.endsWith('/second-factor'))).toBe(false);
  });
  it('retains the server TOTP choice while hiding a passkey unavailable on this device', async () => {
    const app = await nativeApp(locale, {
      passkeys: {
        available: async () => false,
        authenticate: async () => ({ kind: 'unavailable' }),
      },
    });
    app.reply('password', {
      attemptId: ATTEMPT_ID,
      stage: 'secondFactorRequired',
      expiresAt: app.expiresAt,
      factors: ['totp', 'passkey'],
    });
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    expect(isShown(app.root, 'native-totp-choice')).toBe(true);
    expect(isShown(app.root, 'native-passkey-choice')).toBe(false);
    expect(isShown(app.root, 'native-web')).toBe(true);
  });
});
