import { ACTIVITY, ROLE_SLUG, type SessionKind } from '../constants';
import type { Locale, MessageKey, Translate } from '../i18n';
import type { ApiFailure, DeviceName, SessionRow } from '../types';
import { isolateLtr, isolateTyped } from './isolate';
import { isOffline } from './session-rows';

const KIND_TEXT: Record<SessionKind, MessageKey> = {
  browser: 'sessions.kind.browser',
  nativeApp: 'sessions.kind.nativeApp',
};

const ROLE_TEXT = new Map<string, MessageKey>([
  [ROLE_SLUG.USER, 'role.user'],
  [ROLE_SLUG.SUPPORT, 'role.support'],
  [ROLE_SLUG.MANAGER, 'role.manager'],
  [ROLE_SLUG.ADMIN, 'role.admin'],
]);

export function deviceText(t: Translate, device: DeviceName): string {
  if (device.kind === 'named') return isolateLtr(device.name);
  if (device.kind === 'mobileApp')
    return device.system
      ? t('sessions.mobileAppOnSystem', { system: device.system })
      : t('sessions.kind.nativeApp');
  if (device.kind === 'unknown') return t('sessions.unknownDevice');
  return t('sessions.browserOnSystem', { browser: device.browser, system: device.system });
}

export function kindText(t: Translate, kind: SessionKind | undefined): string | undefined {
  return kind === undefined ? undefined : t(KIND_TEXT[kind]);
}

export function activityText(t: Translate, locale: Locale, row: SessionRow): string {
  if (row.activity === ACTIVITY.NOW) return t('sessions.activeNow');
  const at = new Date(row.lastActiveAt);
  if (row.activity === ACTIVITY.TODAY) {
    const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
    return t('sessions.activeToday', { time });
  }
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(at);
  return t('sessions.activeEarlier', { date });
}

/** A role this build has no name for is shown as the server spells it. */
export function roleText(t: Translate, role: string): string {
  const key = ROLE_TEXT.get(role);
  return key === undefined ? isolateLtr(role) : t(key);
}

export interface ProfileText {
  name: string;
  email: string;
  role: string;
}

/** Each value keeps its own reading order inside a line of either direction. */
export function profileText(
  t: Translate,
  profile: { name: string; email: string; role: string },
): ProfileText {
  return {
    name: isolateTyped(profile.name),
    email: isolateLtr(profile.email),
    role: roleText(t, profile.role),
  };
}

export function failureText(t: Translate, failure: ApiFailure | undefined): string {
  return t(isOffline(failure) ? 'common.offline' : 'common.serverError');
}
