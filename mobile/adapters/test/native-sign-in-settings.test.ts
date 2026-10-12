import { describe, expect, it } from 'vitest';
import { readNativeSignInSettings } from '../src/logic/native-sign-in-settings';

describe('runtime native sign-in settings', () => {
  it('reads only public whitelisted fields and the iOS bundle identifier', () => {
    expect(
      readNativeSignInSettings(
        {
          googleIosUrlScheme: 'com.googleusercontent.apps.ios-client',
          appleSignIn: true,
          facebookAppId: '12345',
          facebookClientToken: 'public-token',
          facebookDisplayName: 'Example Mobile',
          passkeyRpId: 'example.test',
          appSecret: 'discarded',
        },
        'com.example.mobile',
      ),
    ).toEqual({
      googleIosUrlScheme: 'com.googleusercontent.apps.ios-client',
      appleSignInEnabled: true,
      iosBundleIdentifier: 'com.example.mobile',
      facebookAppId: '12345',
      facebookClientToken: 'public-token',
      facebookDisplayName: 'Example Mobile',
      passkeyRpId: 'example.test',
    });
  });

  it('fails closed for malformed metadata and incomplete Facebook settings', () => {
    expect(readNativeSignInSettings(null, undefined)).toEqual({ appleSignInEnabled: false });
    expect(
      readNativeSignInSettings(
        { appleSignIn: 'true', facebookAppId: '12345', facebookClientToken: 'token value' },
        42,
      ),
    ).toEqual({ appleSignInEnabled: false });
  });
});
