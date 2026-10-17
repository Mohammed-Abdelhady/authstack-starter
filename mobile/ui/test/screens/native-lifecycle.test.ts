import { TransportError } from '@app/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeApp, disposeNativeApps, ATTEMPT_ID } from '../support/native-auth';
import { cleanup, press, byTestId, isShown, textsOf } from '../support/render';
import { translate } from '../../src/i18n';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(['en'] as const)('native lifecycle handoff in %s', (locale) => {
  it('passes the request-produced registration email into activation and reports a created account when later sign-in fails', async () => {
    const app = await nativeApp(locale);
    app.reply('register', {
      attemptId: ATTEMPT_ID,
      stage: 'registrationCodeRequired',
      expiresAt: app.expiresAt,
      email: 'canonical@example.test',
    });
    app.handle('activate', async () => {
      const record = JSON.parse(app.ports.credentials.value ?? '{}') as {
        transaction?: { state?: string };
      };
      return {
        attemptId: ATTEMPT_ID,
        stage: 'codeReady',
        expiresAt: app.expiresAt,
        activationCompleted: true,
        redirectUri: `sampleapp://auth/callback?code=created-code&state=${record.transaction?.state ?? ''}`,
      };
    });
    app.raw('/api/oauth/token', async () => {
      throw new TransportError();
    });
    await press(app.root, 'native-registration-choice');
    await app.input('native-email', 'typed@example.test');
    await press(app.root, 'native-submit');
    await press(app.root, 'native-resend');
    expect(
      app.transport.sent.filter(({ path }) => path.endsWith('/register')).map(({ body }) => body),
    ).toEqual([{ email: 'typed@example.test' }, { email: 'canonical@example.test' }]);
    await app.input('native-code', '123456');
    await app.input('native-name', 'Person');
    await app.input('native-password', 'New-password1');
    await press(app.root, 'native-submit');
    expect(app.transport.sent.find(({ path }) => path.endsWith('/activate'))?.body).toEqual({
      email: 'canonical@example.test',
      code: '123456',
      name: 'Person',
      password: 'New-password1',
    });
    expect(textsOf(byTestId(app.root, 'native-notice'))).toContain(
      translate(locale, 'native.activationCompleted'),
    );
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(app.engine.snapshot.status).toBe('signedOut');
  });

  it.each([true, false])(
    'claims reset success only for persisted passwordUpdated=%s',
    async (passwordUpdated) => {
      const app = await nativeApp(locale);
      app.reply('recovery/request', {
        attemptId: ATTEMPT_ID,
        stage: 'recoveryCodeRequired',
        expiresAt: app.expiresAt,
        email: 'canonical@example.test',
      });
      app.reply('recovery/confirm', {
        attemptId: ATTEMPT_ID,
        stage: 'recoveryComplete',
        expiresAt: app.expiresAt,
        passwordUpdated,
      });
      await press(app.root, 'native-recovery-choice');
      await app.input('native-email', 'typed@example.test');
      await press(app.root, 'native-submit');
      await app.input('native-code', '123456');
      await app.input('native-password', 'New-password1');
      await press(app.root, 'native-submit');
      expect(
        app.transport.sent.find(({ path }) => path.endsWith('/recovery/confirm'))?.body,
      ).toEqual({ email: 'canonical@example.test', code: '123456', newPassword: 'New-password1' });
      expect(textsOf(byTestId(app.root, 'native-notice'))).toContain(
        translate(locale, passwordUpdated ? 'native.recoveryComplete' : 'native.refused'),
      );
      expect(app.engine.snapshot.status).toBe('signedOut');
      expect(app.transport.sent.some(({ path }) => path === '/api/oauth/token')).toBe(false);
      if (!passwordUpdated) expect(byTestId(app.root, 'native-password').props.value).toBe('');
    },
  );

  it('retains selected registration/recovery in the web alternative', async () => {
    const app = await nativeApp(locale);
    await press(app.root, 'native-registration-choice');
    await press(app.root, 'native-web');
    expect(app.ports.authBrowser.opened[0]?.address).toContain('flow=registration');
    expect(app.ports.authBrowser.opened[0]?.address).toContain(`locale=${locale}`);
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    await press(app.root, 'native-recovery-choice');
    await press(app.root, 'native-web');
    expect(app.ports.authBrowser.opened[1]?.address).toContain('flow=recovery');
    expect(app.ports.credentials.value).toBeUndefined();
  });

  it('reads a requested email-link stage and offers resend without a fake signed-in state', async () => {
    const app = await nativeApp(locale);
    app.reply('email-link/request', {
      attemptId: ATTEMPT_ID,
      stage: 'emailLinkSent',
      expiresAt: app.expiresAt,
      email: 'canonical@example.test',
    });
    await press(app.root, 'native-email-link-choice');
    await app.input('native-email', 'typed@example.test');
    await press(app.root, 'native-submit');
    await press(app.root, 'native-resend');
    const requests = app.transport.sent.filter(({ path }) => path.endsWith('/email-link/request'));
    expect(requests.map(({ body }) => body)).toEqual([
      { email: 'typed@example.test' },
      { email: 'canonical@example.test' },
    ]);
    expect(app.engine.snapshot.status).toBe('signedOut');
    expect(isShown(app.root, 'native-web')).toBe(true);
  });
});
