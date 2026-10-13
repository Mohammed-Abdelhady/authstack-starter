import { COLOR_SCHEME, PALETTE, STATUS_BAR_STYLE } from '../theme/tokens';
import type { Theme } from '../types/theme';

/** Anything the system does not report as dark, no answer included, reads as light. */
export function themeOf(reported: string | null | undefined): Theme {
  const scheme = reported === COLOR_SCHEME.DARK ? COLOR_SCHEME.DARK : COLOR_SCHEME.LIGHT;
  return { scheme, colors: PALETTE[scheme], statusBarStyle: STATUS_BAR_STYLE[scheme] };
}
