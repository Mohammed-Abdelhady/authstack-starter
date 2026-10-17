import { createTranslator } from 'next-intl';
import enKinds from '@/i18n/messages/session-kinds.en.json';
import enBase from '@/i18n/messages/sessions.en.json';
import arKinds from '@/i18n/messages/session-kinds.ar.json'; // feature:locale-ar
import arBase from '@/i18n/messages/sessions.ar.json'; // feature:locale-ar
import { describe, expect, it } from 'vitest';
import { sessionDeviceText } from '../sessionDevice';

const en = { sessions: { ...enBase.sessions, ...enKinds.sessions } };
const ar = { sessions: { ...arBase.sessions, ...arKinds.sessions } }; // feature:locale-ar

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
