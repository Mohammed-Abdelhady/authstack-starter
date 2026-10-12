import { createTranslator } from 'next-intl';
import enKinds from '@/i18n/messages/session-kinds.en.json';
import enBase from '@/i18n/messages/sessions.en.json';
import arKinds from '@/i18n/messages/session-kinds.ar.json'; // feature:locale-ar
import arBase from '@/i18n/messages/sessions.ar.json'; // feature:locale-ar
import { describe, expect, it } from 'vitest';
import {
  browserDeviceText,
  sessionDeviceText,
  describeNativeDevice,
  sessionKindOf,
} from '../sessionDevice';

const en = { sessions: { ...enBase.sessions, ...enKinds.sessions } };
const ar = { sessions: { ...arBase.sessions, ...arKinds.sessions } }; // feature:locale-ar

describe('sessionKindOf', () => {
  it.each([
    ['browser_session', 'browser'],
    ['native_access', 'nativeApp'],
  ])('reads %s as %s', (purpose, kind) => {
    expect(sessionKindOf(purpose)).toBe(kind);
  });

  it.each(['native_refresh', '', 'NATIVE_ACCESS', 'constructor', 'toString'])(
    'has no kind for "%s"',
    (purpose) => {
      expect(sessionKindOf(purpose)).toBeUndefined();
    },
  );
});

describe('describeNativeDevice', () => {
  it.each([
    ['an HTTP client that names no system', 'okhttp/4.12.0'],
    ['the placeholder the server stores for a missing agent', 'native'],
    ['an empty agent', ''],
  ])('is a phone with no system name for %s', (_label, userAgent) => {
    expect(describeNativeDevice(userAgent)).toEqual({ deviceType: 'Mobile', os: null });
  });

  it('names the system an app reports', () => {
    expect(describeNativeDevice('Acme/2.1 (iPhone; iPhone OS 17_2)')).toEqual({
      deviceType: 'Mobile',
      os: 'iOS 17',
    });
  });

  it.each([
    ['Acme/2.1 (iPad; CPU OS 17_2 like Mac OS X)', 'iPadOS 17'],
    ['Acme/2.1 (Linux; Android 14; Pixel Tablet)', 'Android 14'],
  ])('keeps a tablet a tablet for %s', (userAgent, os) => {
    expect(describeNativeDevice(userAgent)).toEqual({ deviceType: 'Tablet', os });
  });
});

describe('structured device naming', () => {
  it.each([
    [
      {
        kind: 'browser',
        browserName: 'Chrome',
        browserMajorVersion: '140',
        platformName: 'macOS',
        platformVersion: '10.15',
      },
      'browserOnSystem',
      { browser: 'Chrome 140', system: 'macOS 10.15' },
    ],
    [{ kind: 'mobileApp', platformName: 'Android' }, 'mobileAppOnSystem', { system: 'Android' }],
    [{ kind: 'mobileApp' }, 'kind.nativeApp', undefined],
    [{ kind: 'unknown' }, 'unknownDevice', undefined],
  ] as const)('uses catalogue arguments for %j', (parts, key, values) => {
    const calls: [string, Record<string, string> | undefined][] = [];
    sessionDeviceText({ deviceParts: parts }, (asked, args) => {
      calls.push([asked, args]);
      return asked;
    });
    expect(calls).toEqual([[key, values]]);
  });

  it('retains the stored phrase for an older server', () => {
    expect(sessionDeviceText({ deviceName: 'Legacy phrase' }, () => 'unused')).toBe(
      'Legacy phrase',
    );
  });
});

describe.each([
  ['en', en],
  ['ar', ar], // feature:locale-ar
] as const)('device catalogue in %s', (locale, messages) => {
  it('composes browser and native names with isolated arguments', () => {
    const t = createTranslator({ locale, messages, namespace: 'sessions' });
    const browser = sessionDeviceText(
      {
        deviceParts: {
          kind: 'browser',
          browserName: 'Chrome',
          browserMajorVersion: '140',
          platformName: 'macOS',
          platformVersion: '10.15',
        },
      },
      t,
    );
    const native = sessionDeviceText(
      { deviceParts: { kind: 'mobileApp', platformName: 'iOS' } },
      t,
    );
    expect({ browser, native, isolated: browser.includes('\u2066macOS 10.15\u2069') }).toEqual({
      browser: messages.sessions.browserOnSystem
        .replace('{browser}', 'Chrome 140')
        .replace('{system}', 'macOS 10.15'),
      native: messages.sessions.mobileAppOnSystem.replace('{system}', 'iOS'),
      isolated: true,
    });
  });
});

describe('legacy browser localization', () => {
  it.each([
    { agent: 'Custom/1.0', browser: 'unknownBrowser', system: 'unknownSystem' },
    { agent: 'Chrome/120 Android 14', browser: 'Chrome 120', system: 'Android 14' },
  ])('translates unknown descriptors from $agent', ({ agent, browser, system }) => {
    const calls: [string, Record<string, string> | undefined][] = [];
    const answer = browserDeviceText(agent, (key, args) => {
      calls.push([key, args]);
      return key;
    });
    expect(answer).toBe('browserOnSystem');
    expect(calls.at(-1)).toEqual(['browserOnSystem', { browser, system }]);
  });
});
