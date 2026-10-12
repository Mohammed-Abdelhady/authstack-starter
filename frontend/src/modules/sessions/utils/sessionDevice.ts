import { DEVICE_KIND, type Session } from '@app/sdk';
import { parseUserAgent, getDeviceLabel } from '@/lib/parseUserAgent';
import type { DeviceType } from '../components/DeviceIcon';
import {
  SESSION_KIND_BY_PURPOSE,
  UNKNOWN_OS_LABELS,
  UNKNOWN_BROWSER_LABELS,
  type SessionKind,
} from '../constants';

const KIND_BY_PURPOSE = new Map<string, SessionKind>(Object.entries(SESSION_KIND_BY_PURPOSE));

/** The kind a row shows, or nothing for a purpose this build does not know. */
export function sessionKindOf(credentialPurpose: string): SessionKind | undefined {
  return KIND_BY_PURPOSE.get(credentialPurpose);
}

export interface NativeDevice {
  readonly deviceType: DeviceType;
  /** Null when the app's user agent names no system. */
  readonly os: string | null;
}

/**
 * A native session's user agent comes from the app's HTTP client, so the
 * browser half of the parse is noise and an unrecognised agent is not a desktop.
 */
export function describeNativeDevice(userAgent: string): NativeDevice {
  const { device, os } = parseUserAgent(userAgent);
  return {
    deviceType: device === 'Tablet' ? 'Tablet' : 'Mobile',
    os: UNKNOWN_OS_LABELS.includes(os) ? null : os,
  };
}

type DeviceTranslator = (
  key:
    | 'unknownDevice'
    | 'unknownBrowser'
    | 'unknownSystem'
    | 'kind.nativeApp'
    | 'browserOnSystem'
    | 'mobileAppOnSystem',
  values?: Record<string, string>,
) => string;

export function browserDeviceText(userAgent: string, t: DeviceTranslator): string {
  const { browser, os } = parseUserAgent(userAgent);
  return t('browserOnSystem', {
    browser: UNKNOWN_BROWSER_LABELS.includes(browser) ? t('unknownBrowser') : browser,
    system: UNKNOWN_OS_LABELS.includes(os) ? t('unknownSystem') : os,
  });
}

/** Catalogue arguments stay language-neutral; templates isolate their LTR runs. */
export function sessionDeviceText(
  session: Pick<Session, 'deviceParts' | 'deviceName'> &
    Partial<Pick<Session, 'userAgent' | 'credentialPurpose'>>,
  t: DeviceTranslator,
): string {
  const parts = session.deviceParts;
  if (!parts) {
    if (
      session.deviceName &&
      (!session.userAgent || session.deviceName !== getDeviceLabel(session.userAgent))
    ) {
      return session.deviceName;
    }
    if (session.credentialPurpose === 'native_access' && session.userAgent) {
      const native = describeNativeDevice(session.userAgent);
      return native.os ? t('mobileAppOnSystem', { system: native.os }) : t('unknownDevice');
    }
    return session.userAgent ? browserDeviceText(session.userAgent, t) : t('unknownDevice');
  }
  const system = [parts.platformName, parts.platformVersion].filter(Boolean).join(' ');
  const browser = [parts.browserName, parts.browserMajorVersion].filter(Boolean).join(' ');
  if (parts.kind === DEVICE_KIND.MOBILE_APP)
    return system ? t('mobileAppOnSystem', { system }) : t('kind.nativeApp');
  if (browser && system) return t('browserOnSystem', { browser, system });
  return browser || system ? `\u2066${browser || system}\u2069` : t('unknownDevice');
}
