import type { COLOR_SCHEME, STATUS_BAR_STYLE, TYPE_ROLE_NAME } from '../theme/tokens';

export type ColorScheme = (typeof COLOR_SCHEME)[keyof typeof COLOR_SCHEME];
export type TypeRoleName = (typeof TYPE_ROLE_NAME)[keyof typeof TYPE_ROLE_NAME];
export type StatusBarStyle = (typeof STATUS_BAR_STYLE)[ColorScheme];
export type LabelTone = Extract<
  keyof Palette,
  'text' | 'danger' | 'onAccent' | 'onDanger' | 'onSecondary' | 'accent'
>;

export interface Theme {
  scheme: ColorScheme;
  colors: Palette;
  statusBarStyle: StatusBarStyle;
}

export interface Palette {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  secondary: string;
  onSecondary: string;
  danger: string;
  onDanger: string;
  border: string;
  separator: string;
  focus: string;
  skeleton: string;
}

export interface TypeRole {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '800';
  color: keyof Palette;
  maxFontScale?: number;
}
