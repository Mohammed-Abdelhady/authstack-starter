import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeApp, disposeNativeApps, ATTEMPT_ID } from './support/native-auth';
import { cleanup, press, isShown } from './support/render';
import { LOCALES } from './support/locales';

vi.mock('react-native', () => import('./support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(LOCALES)('native name activation in %s', (locale) => {
  it.each(['\u{10400}'.repeat(100), ' E\u0301mile '])(
    'passes a supported name from the form through the SDK into consent',
    async (name) => {
      const expectedName = name.startsWith(' ') ? 'Émile' : '\u{10400}'.repeat(100);
      const app = await nativeApp(locale);
      app.reply('register', {
        attemptId: ATTEMPT_ID,
        stage: 'registrationCodeRequired',
        expiresAt: app.expiresAt,
        email: 'canonical@example.test',
      });
      app.reply('activate', {
        attemptId: ATTEMPT_ID,
        stage: 'consentRequired',
        expiresAt: app.expiresAt,
        activationCompleted: true,
        account: { id: 'account-1', email: 'canonical@example.test', name: expectedName },
        application: {
          clientId: 'native-client',
          displayName: 'Native app',
          scopes: ['api'],
          alreadyGranted: false,
        },
      });
      await press(app.root, 'native-registration-choice');
      await app.input('native-email', 'canonical@example.test');
      await press(app.root, 'native-submit');
      await app.input('native-code', '123456');
      await app.input('native-name', name);
      await app.input('native-password', 'New-password1');
      await press(app.root, 'native-submit');
      expect(app.transport.sent.find(({ path }) => path.endsWith('/activate'))?.body).toEqual({
        email: 'canonical@example.test',
        code: '123456',
        name: expectedName,
        password: 'New-password1',
      });
      expect(app.engine.snapshot.nativeAttempt?.stage).toBe('consentRequired');
      expect(isShown(app.root, 'native-consent')).toBe(true);
    },
  );
});
