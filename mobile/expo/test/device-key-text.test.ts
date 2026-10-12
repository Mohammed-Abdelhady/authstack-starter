import type { DeviceKeyReadiness } from '@app/device-key';
import { describe, expect, it } from 'vitest';
import { MESSAGES, type MessageKey } from '../src/i18n/messages';
import { describeDeviceKey } from '../src/logic/device-key-text';

const CASES: [DeviceKeyReadiness, MessageKey][] = [
  [{ kind: 'ready', protection: 'secureEnclave' }, 'deviceKeySecureEnclave'],
  [{ kind: 'ready', protection: 'strongBox' }, 'deviceKeyStrongBox'],
  [{ kind: 'ready', protection: 'trustedEnvironment' }, 'deviceKeyTrustedEnvironment'],
  [{ kind: 'ready', protection: 'software' }, 'deviceKeySoftware'],
  [{ kind: 'noSecureHardware' }, 'deviceKeyNoSecureHardware'],
  [{ kind: 'unavailable' }, 'deviceKeyUnavailable'],
  [{ kind: 'keyInvalidated' }, 'deviceKeyInvalidated'],
];

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('device key presentation in %s', (locale) => {
  it.each(CASES)('translates %j through %s in each locale', (readiness, key) => {
    expect(describeDeviceKey(locale, readiness)).toBe(MESSAGES[locale][key]);
  });
});
