import { describe, expect, it } from 'vitest';
import { createTranslate, translate } from '../src/i18n';
import { deviceNameOf } from '../src/logic/device-name';
import { deviceText, profileText, roleText } from '../src/logic/session-text';

/** Written by hand: U+2066 opens a left-to-right run, U+2068 a run that reads by its first letter, U+2069 closes either. */
const LTR = '⁦';
const FIRST_STRONG = '⁨';
const CLOSE = '⁩';
const ISOLATE = /[⁦-⁩]/g;

const LOCALES = [
  'en',
  'ar', // feature:locale-ar
] as const;

const TYPED_NAMES = [
  'Acme Inc.',
  'C++ (beta)',
  '',
  'شركة (تجريبية)', // feature:locale-ar
];

describe.each(LOCALES)('values from outside in %s', (locale) => {
  const t = createTranslate(locale);

  it.each(TYPED_NAMES)('lets the product name %j read by its own first letter', (appName) => {
    const title = translate(locale, 'signIn.title', { appName });

    expect(title).toContain(`${FIRST_STRONG}${appName}${CLOSE}`);
    expect(title.match(ISOLATE)).toEqual([FIRST_STRONG, CLOSE]);
  });

  it.each(['203.0.113.7', '2001:db8::1', 'unknown'])('keeps the address %s left to right', (ip) => {
    const line = translate(locale, 'sessions.address', { ip });

    expect(line).toContain(`${LTR}${ip}${CLOSE}`);
    expect(line.match(ISOLATE)).toEqual([LTR, CLOSE]);
  });

  it.each(TYPED_NAMES)('lets the account name %j read by its own first letter', (name) => {
    const profile = profileText(t, { name, email: 'a@example.test', role: 'user' });

    expect(profile.name).toBe(`${FIRST_STRONG}${name}${CLOSE}`);
  });

  it('keeps the email address left to right and a known role in the catalogue', () => {
    const profile = profileText(t, { name: 'A', email: '123+tag@example.test', role: 'admin' });

    expect(profile.email).toBe(`${LTR}123+tag@example.test${CLOSE}`);
    expect(profile.role).toBe(translate(locale, 'role.admin'));
    expect(profile.role.match(ISOLATE)).toBeNull();
  });

  it('keeps a role the build has no name for left to right', () => {
    expect(roleText(t, 'night-shift')).toBe(`${LTR}night-shift${CLOSE}`);
  });

  it.each([
    ['a stored phrase', { userAgent: '', deviceName: 'Chrome 140 on macOS 10.15' }, false],
    ['a system read from the agent', { userAgent: 'okhttp/4.12.0' }, true],
    [
      'a system named by the server',
      { userAgent: '', deviceParts: { kind: 'unknown', platformName: 'Android' } },
      false,
    ],
  ] as const)('isolates %s once, alone and inside a sentence', (_name, session, isNativeApp) => {
    const named = deviceNameOf(session, isNativeApp);
    const device = deviceText(t, named);

    expect(named.kind).toBe('named');
    expect(device.match(ISOLATE)).toEqual([FIRST_STRONG, CLOSE]);
    expect(device.startsWith(FIRST_STRONG) && device.endsWith(CLOSE)).toBe(true);
    for (const key of [
      'sessions.revokeLabel',
      'sessions.confirmRevoke.title',
      'sessions.revokeFailed.title',
    ] as const) {
      const message = translate(locale, key, { device });
      expect(message).toContain(device);
      if (locale === 'ar') expect(message).toContain(`${FIRST_STRONG}${device}${CLOSE}`); // feature:locale-ar
    }
  });
});
