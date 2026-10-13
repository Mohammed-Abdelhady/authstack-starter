import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeApp, disposeNativeApps, ATTEMPT_ID } from '../support/native-auth';
import { cleanup, press } from '../support/render';
import { device } from '../support/react-native';
import { LOCALES } from '../support/locales';

vi.mock('react-native', () => import('../support/react-native'));
afterEach(() => {
  cleanup();
  disposeNativeApps();
});

describe.each(LOCALES)('native title accessibility handoff in %s', (locale) => {
  it('focuses the new email-link-sent title through the native accessibility boundary', async () => {
    const app = await nativeApp(locale);
    app.reply('email-link/request', {
      attemptId: ATTEMPT_ID,
      stage: 'emailLinkSent',
      expiresAt: app.expiresAt,
      email: 'person@example.test',
    });
    await press(app.root, 'native-email-link-choice');
    await app.input('native-email', 'person@example.test');
    const before = device.accessibilityFocusTags.length;
    await press(app.root, 'native-submit');
    expect(device.accessibilityFocusTags.length).toBe(before + 1);
  });
  it('focuses the root title again when a native form is cancelled', async () => {
    const app = await nativeApp(locale);
    await press(app.root, 'native-password-choice');
    const before = device.accessibilityFocusTags.length;
    await press(app.root, 'native-cancel');
    expect(device.accessibilityFocusTags.length).toBe(before + 1);
  });
});
