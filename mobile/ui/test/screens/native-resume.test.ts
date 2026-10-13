import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiReply, oauthTokenReply, successUserReply } from '../../../auth/test/support/support';
import {
  nativeApp,
  disposeNativeApps,
  ATTEMPT_ID,
  ATTEMPT_SECRET,
  METHODS,
} from '../support/native-auth';
import { cleanup, press, byTestId, isShown, textsOf } from '../support/render';
import { translate } from '../../src/i18n';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(LOCALES)('native second-step resume in %s', (locale) => {
  it('switches a resumed journey to browser after direct methods are disabled', async () => {
    const app = await nativeApp(locale);
    const mfa = {
      attemptId: ATTEMPT_ID,
      stage: 'secondFactorRequired',
      expiresAt: app.expiresAt,
      factors: ['totp', 'recoveryCode'],
    };
    app.reply('password', mfa);
    app.raw(`/api/auth/native/attempts/${ATTEMPT_ID}`, async () => apiReply(mfa));
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    app.methods({ ...METHODS, nativeEnabled: false });
    await app.remount();
    expect(isShown(app.root, 'native-totp-choice')).toBe(true);
    await press(app.root, 'native-web');
    expect(app.ports.authBrowser.opened).toHaveLength(1);
    expect(new URL(app.ports.authBrowser.opened[0]!.address).searchParams.get('locale')).toBe(
      locale,
    );
    expect(app.transport.sent.some(({ path }) => path.endsWith('/cancel'))).toBe(true);
  });

  it('restores real persisted MFA and uses only the factors returned by the server', async () => {
    const app = await nativeApp(locale);
    const mfa = {
      attemptId: ATTEMPT_ID,
      stage: 'secondFactorRequired',
      expiresAt: app.expiresAt,
      factors: ['totp', 'recoveryCode'],
    };
    app.reply('password', mfa);
    app.raw(`/api/auth/native/attempts/${ATTEMPT_ID}`, async () => apiReply(mfa));
    app.reply('second-factor', {
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
    });
    await press(app.root, 'native-password-choice');
    await app.input('native-email', 'person@example.test');
    await app.input('native-password', 'Temporary-secret1');
    await press(app.root, 'native-submit');
    await app.remount();
    expect(isShown(app.root, 'native-passkey-choice')).toBe(false);
    await press(app.root, 'native-totp-choice');
    await app.input('native-code', '123456');
    await press(app.root, 'native-recovery-code-choice');
    expect(byTestId(app.root, 'native-code').props.value).toBe('');
    await app.input('native-code', 'ABCD-EFGH-IJKL');
    await press(app.root, 'native-submit');
    const call = app.transport.sent.find(({ path }) => path.endsWith('/second-factor'));
    expect(call?.body).toEqual({ recoveryCode: 'ABCD-EFGH-IJKL' });
    expect(call?.headers?.['X-Native-Attempt']).toBe(ATTEMPT_SECRET);
    expect(isShown(app.root, 'native-consent')).toBe(true);
    expect(app.ports.credentials.value).not.toContain('ABCD-EFGH-IJKL');
    expect(app.transport.sent.some(({ path }) => path === '/api/oauth/token')).toBe(false);
  });

  it('continues a cold email link through the actual callback and consent without adopting a token in the UI', async () => {
    const app = await nativeApp(locale);
    const sent = {
      attemptId: ATTEMPT_ID,
      stage: 'emailLinkSent',
      expiresAt: app.expiresAt,
      email: 'person@example.test',
    };
    app.reply('email-link/request', sent);
    app.raw(`/api/auth/native/attempts/${ATTEMPT_ID}`, async () => apiReply(sent));
    app.reply('email-link/verify', {
      attemptId: ATTEMPT_ID,
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
    await press(app.root, 'native-email-link-choice');
    await app.input('native-email', 'person@example.test');
    await press(app.root, 'native-submit');
    const record = JSON.parse(app.ports.credentials.value ?? '{}') as {
      transaction?: { state?: string };
    };
    app.ports.callbacks.initial = `sampleapp://auth/callback?native_attempt_id=${ATTEMPT_ID}&native_email_token=one-use-token&state=${record.transaction?.state ?? ''}`;
    await app.remount();
    expect(isShown(app.root, 'native-consent')).toBe(true);
    expect(
      app.transport.sent.find(({ path }) => path.endsWith('/email-link/verify'))?.body,
    ).toEqual({ token: 'one-use-token', state: record.transaction?.state });
    expect(app.ports.credentials.value).not.toContain('one-use-token');
    app.handle('consent', async () => ({
      attemptId: ATTEMPT_ID,
      stage: 'codeReady',
      expiresAt: app.expiresAt,
      redirectUri: `sampleapp://auth/callback?code=issued-code&state=${record.transaction?.state ?? ''}`,
    }));
    app.raw('/api/oauth/token', async () => oauthTokenReply());
    app.raw('/api/user/profile', async () => successUserReply());
    await press(app.root, 'native-consent-accept');
    expect(app.engine.snapshot.status).toBe('signedIn');
    expect(isShown(app.root, 'account-screen')).toBe(true);
  });

  it('keeps a failed secure cancellation visible and allows another attempt', async () => {
    const app = await nativeApp(locale);
    await press(app.root, 'native-password-choice');
    app.ports.credentials.writeResult = { kind: 'locked' };
    await press(app.root, 'native-cancel');
    expect(textsOf(byTestId(app.root, 'native-notice'))).toContain(
      translate(locale, 'signIn.failed.storage'),
    );
    expect(app.ports.credentials.value).toContain(ATTEMPT_ID);
    app.ports.credentials.writeResult = undefined;
    await press(app.root, 'native-cancel');
    expect(isShown(app.root, 'native-password-choice')).toBe(true);
    expect(app.ports.credentials.value).toBeUndefined();
  });
});
