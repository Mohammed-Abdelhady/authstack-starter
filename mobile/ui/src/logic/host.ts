import type { AuthEngine } from '@app/native-auth';
import { DIRECTION, resolveLocale, translate, type Direction, type Locale } from '../i18n';
import type { EdgeInsets, NativeAppProps, PhysicalInsets } from '../types';

const systemLocaleTag = (): string => new Intl.DateTimeFormat().resolvedOptions().locale;

/** The language the screens read in. A runtime that cannot name its locale reads English. */
export function deviceLocale(readTag: () => string | undefined = systemLocaleTag): Locale {
  try {
    return resolveLocale(readTag());
  } catch {
    return resolveLocale(undefined);
  }
}

/** A safe-area source reports left and right. The start edge is the right one when reading right to left. */
export function logicalInsets(physical: PhysicalInsets, locale: Locale): EdgeInsets {
  const rtl = DIRECTION[locale] === 'rtl';
  return {
    top: physical.top,
    bottom: physical.bottom,
    start: rtl ? physical.right : physical.left,
    end: rtl ? physical.left : physical.right,
  };
}

/** What a shell shows while it prepares, in the language the screens will read in. */
export function startingNotice(locale: Locale): { text: string; direction: Direction } {
  return { text: translate(locale, 'common.starting'), direction: DIRECTION[locale] };
}

/** What a shell built: its engine, and wall time from the clock that engine reads. */
export interface HostAuth {
  engine: AuthEngine;
  now(): number;
}

export type HostProps = Pick<NativeAppProps, 'engine' | 'appName' | 'locale' | 'now'>;

/** What the screens receive from a shell, apart from the safe area. */
export function hostProps(auth: HostAuth, appName: string, locale: Locale): HostProps {
  return { engine: auth.engine, appName, locale, now: auth.now };
}
