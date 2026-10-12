import { DEVICE_KIND } from '../constants/session';
import type { DeviceParts } from '@app/sdk';
import { USER_AGENT_MAX_LENGTH } from '../../session/constants/session-policy';

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export interface ParsedUserAgent {
  type: DeviceType;
  browser: string;
  os: string;
  name: string;
  parts: DeviceParts;
}

function detectDeviceType(ua: string): DeviceType {
  const lowerUA = ua.toLowerCase();

  if (
    /ipad|tablet|kindle|silk|playbook/i.test(lowerUA) ||
    (/android/i.test(lowerUA) && !/mobile/i.test(lowerUA))
  ) {
    return 'tablet';
  }

  if (
    /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(lowerUA)
  ) {
    return 'mobile';
  }

  return 'desktop';
}

function detectBrowser(ua: string): string {
  const lowerUA = ua.toLowerCase();

  if (/edg/i.test(ua)) {
    const match = ua.match(/edg[ea]?\/(\d+)/i);
    return match ? `Edge ${match[1]}` : 'Edge';
  }

  if (/opera|opr/i.test(lowerUA)) {
    const match = ua.match(/(?:opera|opr)\/(\d+)/i);
    return match ? `Opera ${match[1]}` : 'Opera';
  }

  if (/samsungbrowser/i.test(lowerUA)) {
    const match = ua.match(/samsungbrowser\/(\d+)/i);
    return match ? `Samsung ${match[1]}` : 'Samsung Browser';
  }

  if (/chrome/i.test(lowerUA)) {
    const match = ua.match(/chrome\/(\d+)/i);
    return match ? `Chrome ${match[1]}` : 'Chrome';
  }

  if (/safari/i.test(lowerUA)) {
    const match = ua.match(/version\/(\d+)/i);
    return match ? `Safari ${match[1]}` : 'Safari';
  }

  if (/firefox/i.test(lowerUA)) {
    const match = ua.match(/firefox\/(\d+)/i);
    return match ? `Firefox ${match[1]}` : 'Firefox';
  }

  if (/msie|trident/i.test(lowerUA)) {
    const match = ua.match(/(?:msie |rv:)(\d+)/i);
    return match ? `IE ${match[1]}` : 'IE';
  }

  return 'Unknown Browser';
}

function detectOS(ua: string): string {
  const lowerUA = ua.toLowerCase();

  if (/windows nt 10/i.test(lowerUA)) {
    return 'Windows 10/11';
  }
  if (/windows nt 6.3/i.test(lowerUA)) {
    return 'Windows 8.1';
  }
  if (/windows nt 6.2/i.test(lowerUA)) {
    return 'Windows 8';
  }
  if (/windows nt 6.1/i.test(lowerUA)) {
    return 'Windows 7';
  }
  if (/windows/i.test(lowerUA)) {
    return 'Windows';
  }

  if (/ipad.*os (\d+)/i.test(lowerUA)) {
    const match = ua.match(/os (\d+)/i);
    return match ? `iPadOS ${match[1]}` : 'iPadOS';
  }
  if (/ipad/i.test(lowerUA)) {
    return 'iPadOS';
  }
  if (/iphone os (\d+)/i.test(lowerUA)) {
    const match = ua.match(/iphone os (\d+)/i);
    return match ? `iOS ${match[1]}` : 'iOS';
  }
  if (/iphone|ipod/i.test(lowerUA)) {
    return 'iOS';
  }

  if (/mac os x 10[._](\d+)/i.test(lowerUA)) {
    const match = ua.match(/mac os x 10[._](\d+)/i);
    return match ? `macOS 10.${match[1]}` : 'macOS';
  }
  if (/mac os x/i.test(lowerUA)) {
    return 'macOS';
  }
  if (/macintosh/i.test(lowerUA)) {
    return 'Mac OS';
  }

  if (/android (\d+)/i.test(lowerUA)) {
    const match = ua.match(/android (\d+)/i);
    return match ? `Android ${match[1]}` : 'Android';
  }
  if (/android/i.test(lowerUA)) {
    return 'Android';
  }

  if (/linux/i.test(lowerUA)) {
    if (/ubuntu/i.test(lowerUA)) {
      return 'Ubuntu';
    }
    if (/debian/i.test(lowerUA)) {
      return 'Debian';
    }
    if (/fedora/i.test(lowerUA)) {
      return 'Fedora';
    }
    return 'Linux';
  }

  if (/cros/i.test(lowerUA)) {
    return 'Chrome OS';
  }

  return 'Unknown OS';
}

export function parseUserAgent(userAgent: string): ParsedUserAgent {
  userAgent =
    typeof userAgent === 'string'
      ? userAgent.slice(0, USER_AGENT_MAX_LENGTH)
      : '';
  if (!userAgent.trim()) {
    return {
      type: 'unknown',
      browser: 'Unknown Browser',
      os: 'Unknown OS',
      name: 'Unknown device',
      parts: { kind: DEVICE_KIND.UNKNOWN },
    };
  }

  const nativePlatform = /cfnetwork\/|darwin\//i.test(userAgent)
    ? 'iOS'
    : /okhttp\/|dalvik\//i.test(userAgent)
      ? 'Android'
      : undefined;
  const type = nativePlatform ? 'mobile' : detectDeviceType(userAgent);
  const browser = detectBrowser(userAgent);
  const detectedOS = detectOS(userAgent);
  const os =
    detectedOS === 'Unknown OS' && nativePlatform ? nativePlatform : detectedOS;
  const parts = deviceParts(browser, os, nativePlatform !== undefined);

  const name = nativePlatform
    ? `Mobile app on ${os}`
    : browser === 'Unknown Browser' && os === 'Unknown OS'
      ? 'Unknown device'
      : `${browser} on ${os}`;

  return {
    type,
    browser,
    os,
    name,
    parts,
  };
}

export function getDeviceLabel(userAgent: string): string {
  const { name } = parseUserAgent(userAgent);
  return name;
}

function deviceParts(
  browser: string,
  os: string,
  native: boolean,
): DeviceParts {
  const browserMatch =
    browser === 'Unknown Browser'
      ? undefined
      : browser.match(/^(.+?)(?: (\d+))?$/);
  const platformMatch =
    os === 'Unknown OS' ? undefined : os.match(/^(.+?)(?: ([\d./]+))?$/);
  return {
    kind: native
      ? DEVICE_KIND.MOBILE_APP
      : browserMatch
        ? DEVICE_KIND.BROWSER
        : DEVICE_KIND.UNKNOWN,
    ...(browserMatch && !native
      ? {
          browserName: browserMatch[1],
          ...(browserMatch[2] ? { browserMajorVersion: browserMatch[2] } : {}),
        }
      : {}),
    ...(platformMatch
      ? {
          platformName: platformMatch[1],
          ...(platformMatch[2] ? { platformVersion: platformMatch[2] } : {}),
        }
      : {}),
  };
}
