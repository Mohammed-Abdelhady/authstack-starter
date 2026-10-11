import { DEVICE_KIND, type Session } from '@app/sdk';
import { SERVER_UNKNOWN_DEVICE } from '../constants';
import type { DeviceName } from '../types';

type Family = readonly [pattern: RegExp, name: string];

/** Ordered: an iPhone agent also says "Mac OS X", and Edge and Opera also say "Chrome". */
const SYSTEMS: readonly Family[] = [
  [/windows/i, 'Windows'],
  [/ipad/i, 'iPadOS'],
  [/iphone|ipod/i, 'iOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/android/i, 'Android'],
  [/cros/i, 'ChromeOS'],
  [/linux/i, 'Linux'],
];

/** The app's HTTP client names its library, not the phone, so the library stands for the system. */
const APP_SYSTEMS: readonly Family[] = [
  ...SYSTEMS,
  [/cfnetwork|darwin/i, 'iOS'],
  [/okhttp|dalvik/i, 'Android'],
];

const BROWSERS: readonly Family[] = [
  [/edg/i, 'Edge'],
  [/opera|opr\//i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios/i, 'Chrome'],
  [/safari/i, 'Safari'],
];

function familyOf(userAgent: string, families: readonly Family[]): string | undefined {
  return families.find(([pattern]) => pattern.test(userAgent))?.[1];
}

/**
 * Structured parts use catalogues; legacy sessions retain their stored phrase,
 * except the server's own placeholder, which is no name at all.
 */
export function deviceNameOf(
  session: Pick<Session, 'deviceName' | 'userAgent' | 'deviceParts'>,
  isNativeApp: boolean,
): DeviceName {
  const parts = session.deviceParts;
  if (parts) {
    const system = [parts.platformName, parts.platformVersion].filter(Boolean).join(' ');
    const browser = [parts.browserName, parts.browserMajorVersion].filter(Boolean).join(' ');
    if (parts.kind === DEVICE_KIND.MOBILE_APP) return { kind: 'mobileApp', system };
    if (browser && system) return { kind: 'browser', browser, system };
    if (browser || system) return { kind: 'named', name: `\u2066${browser || system}\u2069` };
    return { kind: 'unknown' };
  }
  const stored = session.deviceName?.trim();
  if (stored && stored !== SERVER_UNKNOWN_DEVICE) return { kind: 'named', name: stored };
  const system = familyOf(session.userAgent, isNativeApp ? APP_SYSTEMS : SYSTEMS);
  if (system === undefined) return { kind: 'unknown' };
  const browser = isNativeApp ? undefined : familyOf(session.userAgent, BROWSERS);
  return browser === undefined
    ? { kind: 'named', name: system }
    : { kind: 'browser', browser, system };
}
