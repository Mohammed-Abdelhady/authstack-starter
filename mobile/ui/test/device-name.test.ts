import { describe, expect, it } from 'vitest';
import type { DeviceParts } from '@app/sdk';
import { deviceNameOf } from '../src/logic/device-name';
import { deviceText } from '../src/logic/session-text';
import { createTranslate, MESSAGES, type MessageKey, type MessageArguments } from '../src/i18n';

const CASES: readonly [DeviceParts, MessageKey, MessageArguments | undefined][] = [
  [
    {
      kind: 'browser',
      browserName: 'Chrome',
      browserMajorVersion: '140',
      platformName: 'macOS',
      platformVersion: '10.15',
    },
    'sessions.browserOnSystem',
    { browser: 'Chrome 140', system: 'macOS 10.15' },
  ],
  [{ kind: 'mobileApp', platformName: 'iOS' }, 'sessions.mobileAppOnSystem', { system: 'iOS' }],
  [{ kind: 'mobileApp' }, 'sessions.kind.nativeApp', undefined],
  [{ kind: 'unknown' }, 'sessions.unknownDevice', undefined],
];

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('device parts in %s', (locale) => {
  it.each(CASES)('composes %j through the catalogue', (deviceParts, key, values) => {
    const calls: [MessageKey, MessageArguments | undefined][] = [];
    const device = deviceNameOf({ userAgent: '', deviceName: 'Legacy phrase', deviceParts }, false);
    const result = deviceText((asked, args) => {
      calls.push([asked, args]);
      return createTranslate(locale)(asked, args);
    }, device);
    const expected = MESSAGES[locale][key].replace(
      /\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? '',
    );
    expect({ calls, result }).toEqual({ calls: [[key, values]], result: expected });
  });

  it('keeps legacy phrases when parts are absent', () => {
    expect(
      deviceText(
        createTranslate(locale),
        deviceNameOf({ userAgent: 'okhttp/4.12.0', deviceName: 'Legacy phrase' }, true),
      ),
    ).toBe('\u2068Legacy phrase\u2069');
  });

  it("reads the server's own placeholder in the app's language", () => {
    const device = deviceNameOf({ userAgent: 'curl/8.9.1', deviceName: 'Unknown device' }, false);

    expect(deviceText(createTranslate(locale), device)).toBe(
      MESSAGES[locale]['sessions.unknownDevice'],
    );
  });

  it('keeps a platform-only result readable', () => {
    expect(
      deviceText(
        createTranslate(locale),
        deviceNameOf(
          {
            userAgent: '',
            deviceParts: { kind: 'unknown', platformName: 'Android', platformVersion: '14' },
          },
          false,
        ),
      ),
    ).toBe('\u2068Android 14\u2069');
  });

  it('isolates complete proper-name and version runs', () => {
    const result = deviceText(
      createTranslate(locale),
      deviceNameOf({ userAgent: '', deviceParts: CASES[0]![0] }, false),
    );
    expect(result.match(/\u2066[^\u2069]*\u2069/g)).toEqual([
      '\u2066Chrome 140\u2069',
      '\u2066macOS 10.15\u2069',
    ]);
  });
});
