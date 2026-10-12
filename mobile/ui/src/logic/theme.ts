import {
  COLOR_SCHEME,
  PALETTE,
  STATUS_BAR_STYLE,
  type ColorScheme,
  type Palette,
  type StatusBarStyle,
} from '../theme/tokens';

export interface Theme {
  scheme: ColorScheme;
  colors: Palette;
  statusBarStyle: StatusBarStyle;
}

/** Anything the system does not report as dark, no answer included, reads as light. */
export function themeOf(reported: string | null | undefined): Theme {
  const scheme = reported === COLOR_SCHEME.DARK ? COLOR_SCHEME.DARK : COLOR_SCHEME.LIGHT;
  return { scheme, colors: PALETTE[scheme], statusBarStyle: STATUS_BAR_STYLE[scheme] };
}
