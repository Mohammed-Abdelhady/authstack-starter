import { describe, expect, it } from 'vitest';
import type { DeviceParts } from '@app/sdk';
import { deviceNameOf } from '../src/logic/device-name';
import { deviceText } from '../src/logic/session-text';
import { createTranslate, type MessageKey, type MessageArguments } from '../src/i18n';

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
