import { parseSignIn } from './native-sign-in-config.util';

const BASE = { passkeys: true, rpId: 'example.test' };
const ANDROID_ORIGIN = `android:apk-key-hash:${'A'.repeat(43)}`;

describe('native passkey origin configuration', () => {
  it('accepts an exact Android APK SHA-256 hash and an HTTPS origin', () => {
    expect(
      parseSignIn(
        { ...BASE, origins: [ANDROID_ORIGIN, 'https://example.test'] },
        0,
        'com.example.mobile',
      )?.origins,
    ).toEqual([ANDROID_ORIGIN, 'https://example.test']);
  });

  it.each([
    'android:apk-key-hash:',
    `android:apk-key-hash:${'A'.repeat(42)}`,
    `android:apk-key-hash:${'A'.repeat(44)}`,
    `android:apk-key-hash:${'A'.repeat(42)}=`,
    `android:apk-key-hash:${'A'.repeat(42)}+`,
    'android:apk-key-hash:../../bad',
    'http://example.test',
    'https://example.test/path',
  ])('rejects malformed origin %s', (origin) => {
    expect(() =>
      parseSignIn({ ...BASE, origins: [origin] }, 0, 'com.example.mobile'),
    ).toThrow('signIn.origins');
  });
});
