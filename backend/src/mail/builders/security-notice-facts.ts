import type { DeviceParts } from '@app/sdk';
import type { SupportedLocale } from '../../common/constants/locales';
import { DEVICE_KIND } from '../../common/constants/session';
import { STAFF_SECURITY_NOTICES } from '../../user/constants/security-notice.constants';
import type {
  SecurityNotice,
  SecurityNoticeFacts,
} from '../../user/types/security-notice.type';
import type { SecurityNoticeMessages } from '../catalog/en/security-notice';
import { formatMessage } from '../catalog/format-message';
import type { MessageArguments } from '../catalog/format-message';

/** A catalogue sentence and the outside values it is filled with. */
export interface FactsSentence {
  message: string;
  args: MessageArguments;
}

/**
 * The moment in the recipient's language, in UTC and named as such. Digits
 * stay Western in every language, as they are in the rest of the mail.
 */
export function noticeTime(locale: SupportedLocale, at: Date): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(at);
}

/** The device in words: a browser by name, the app, or neither. */
export function deviceWords(
  copy: SecurityNoticeMessages,
  device: DeviceParts,
): string {
  const platform = device.platformName;
  if (device.kind === DEVICE_KIND.MOBILE_APP) {
    return platform
      ? formatMessage(copy.deviceAppOnPlatform, { platform })
      : copy.deviceApp;
  }
  const browser = device.browserName;
  if (device.kind === DEVICE_KIND.BROWSER && browser) {
    return platform
      ? formatMessage(copy.deviceBrowserOnPlatform, { browser, platform })
      : formatMessage(copy.deviceBrowser, { browser });
  }
  return copy.deviceUnknown;
}

/**
 * When it happened, and from which device. A staff action names no device:
 * the device was the staff member's.
 */
export function factsSentence(
  locale: SupportedLocale,
  copy: SecurityNoticeMessages,
  notice: SecurityNotice,
  facts: SecurityNoticeFacts,
): FactsSentence {
  const when = noticeTime(locale, facts.at);
  if (STAFF_SECURITY_NOTICES.has(notice) || facts.device === undefined) {
    return { message: copy.happenedAt, args: { when } };
  }
  return {
    message: copy.happenedAtFrom,
    args: { when, device: deviceWords(copy, facts.device) },
  };
}
