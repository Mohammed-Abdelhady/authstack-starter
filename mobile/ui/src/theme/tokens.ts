/** Every colour, size, radius, type value and duration the screens use. Nothing else holds a literal. */

export const COLOR_SCHEME = { LIGHT: 'light', DARK: 'dark' } as const;
import type { ColorScheme, Palette, TypeRole, TypeRoleName } from '../types/theme';

// web-colors:start
// Native color roles from frontend/src/app/tokens.css.
export const PALETTE: Record<ColorScheme, Palette> = {
  light: {
    background: '#F6F7F8',
    surface: '#FFFFFF',
    text: '#040A1A',
    textMuted: '#494F5A',
    accent: '#2D2FD2',
    onAccent: '#FFFFFF',
    secondary: '#F3F4F6',
    onSecondary: '#040A1A',
    danger: '#C52020',
    onDanger: '#FFFFFF',
    border: '#868FA2',
    separator: '#DCDFE4',
    focus: '#2D2FD2',
    skeleton: '#F3F4F6',
  },
  dark: {
    background: '#040916',
    surface: '#0E1320',
    text: '#F3F5F7',
    textMuted: '#AFB6C0',
    accent: '#8889F2',
    onAccent: '#040A1A',
    secondary: '#1F2937',
    onSecondary: '#F3F5F7',
    danger: '#E56C6C',
    onDanger: '#040A1A',
    border: '#54657D',
    separator: '#29313D',
    focus: '#8889F2',
    skeleton: '#1F2937',
  },
};
// web-colors:end

/** The system bar's clock and icons, drawn in the shade that reads on the scheme's background. */
export const STATUS_BAR_STYLE = {
  light: 'dark-content',
  dark: 'light-content',
} as const satisfies Record<ColorScheme, string>;

/** For a border that takes its place in the layout before it has a colour to show. */
export const TRANSPARENT = 'transparent';

export const SPACE = { XS: 4, SM: 8, MD: 12, LG: 16, XL: 24, XXL: 32, XXXL: 48 } as const;

/** One soft radius for surfaces and controls, a smaller one for badges. */
export const RADIUS = { SURFACE: 8, CONTROL: 8, BADGE: 6 } as const;

export const SIZE = {
  /** Smallest side of anything a finger presses. */
  TARGET_MIN: 48,
  AUTH_CONTROL: 56,
  /** The rule on the start edge of a notice and of this device's session. */
  EDGE_RULE: 3,
  BORDER: 1,
  FOCUS_RING: 2,
  SKELETON_LINE: 16,
  SKELETON_TITLE: 28,
  /** Share of the row a skeleton line fills, so the placeholder reads as text. */
  SKELETON_SHORT: '45%',
  SKELETON_LONG: '80%',
  CONTENT_MAX_WIDTH: 560,
} as const;

export const TYPE_ROLE_NAME = {
  SCREEN_TITLE: 'screenTitle',
  AUTH_TITLE: 'authTitle',
  SECTION_HEADING: 'sectionHeading',
  DESCRIPTION: 'description',
  BODY: 'body',
  LABEL: 'label',
} as const;
/**
 * Line heights leave room for letterforms that sit taller than Latin ones.
 * The title is already large, so it stops growing at twice its size: beyond that
 * a single word no longer fits a phone's width and breaks in the middle.
 */
export const TYPE_ROLE: Record<TypeRoleName, TypeRole> = {
  screenTitle: {
    fontSize: 24,
    lineHeight: 36,
    fontWeight: '600',
    color: 'text',
    maxFontScale: 2,
  },
  authTitle: { fontSize: 24, lineHeight: 36, fontWeight: '800', color: 'text', maxFontScale: 2 },
  sectionHeading: { fontSize: 18, lineHeight: 28, fontWeight: '600', color: 'text' },
  description: { fontSize: 14, lineHeight: 22, fontWeight: '400', color: 'textMuted' },
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400', color: 'text' },
  label: { fontSize: 16, lineHeight: 24, fontWeight: '500', color: 'text' },
};

export const MOTION = {
  PRESS_SCALE: 0.98,
  PRESS_MS: 90,
  SCREEN_MS: 220,
  /** How far a screen travels along the reading direction as it arrives. */
  SCREEN_SHIFT: 24,
  SKELETON_MS: 900,
} as const;

export const OPACITY = {
  FULL: 1,
  PRESSED: 0.86,
  DISABLED: 0.6,
  SKELETON_LOW: 0.45,
  HIDDEN: 0,
} as const;
