/** Every colour, size, radius, type value and duration the screens use. Nothing else holds a literal. */

export const COLOR_SCHEME = { LIGHT: 'light', DARK: 'dark' } as const;
export type ColorScheme = (typeof COLOR_SCHEME)[keyof typeof COLOR_SCHEME];

export interface Palette {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  border: string;
  focus: string;
  skeleton: string;
}

export const PALETTE: Record<ColorScheme, Palette> = {
  light: {
    background: '#EEF2F0',
    surface: '#FAFCFB',
    text: '#10201B',
    textMuted: '#45564F',
    accent: '#0B5A47',
    onAccent: '#F2FBF7',
    danger: '#9C2219',
    border: '#6F807A',
    focus: '#10201B',
    skeleton: '#D5DDD9',
  },
  dark: {
    background: '#0C1412',
    surface: '#141F1C',
    text: '#E4EDE9',
    textMuted: '#A6B6AF',
    accent: '#62D3B1',
    onAccent: '#05211A',
    danger: '#FF9C91',
    border: '#6E817A',
    focus: '#E4EDE9',
    skeleton: '#22302B',
  },
};

/** The system bar's clock and icons, drawn in the shade that reads on the scheme's background. */
export const STATUS_BAR_STYLE = {
  light: 'dark-content',
  dark: 'light-content',
} as const satisfies Record<ColorScheme, string>;
export type StatusBarStyle = (typeof STATUS_BAR_STYLE)[ColorScheme];

/** For a border that takes its place in the layout before it has a colour to show. */
export const TRANSPARENT = 'transparent';

export const SPACE = { XS: 4, SM: 8, MD: 12, LG: 16, XL: 24, XXL: 32, XXXL: 48 } as const;

/** One soft radius for surfaces and controls, a smaller one for badges. */
export const RADIUS = { SURFACE: 14, BADGE: 8 } as const;

export const SIZE = {
  /** Smallest side of anything a finger presses. */
  TARGET_MIN: 48,
  /** The rule on the start edge of a notice and of this device's session. */
  EDGE_RULE: 3,
  BORDER: 1,
  FOCUS_RING: 3,
  SKELETON_LINE: 16,
  SKELETON_TITLE: 28,
  /** Share of the row a skeleton line fills, so the placeholder reads as text. */
  SKELETON_SHORT: '45%',
  SKELETON_LONG: '80%',
  CONTENT_MAX_WIDTH: 560,
} as const;

export const TYPE_ROLE_NAME = {
  SCREEN_TITLE: 'screenTitle',
  SECTION_HEADING: 'sectionHeading',
  DESCRIPTION: 'description',
  BODY: 'body',
  LABEL: 'label',
} as const;
export type TypeRoleName = (typeof TYPE_ROLE_NAME)[keyof typeof TYPE_ROLE_NAME];

export interface TypeRole {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '600' | '700';
  /** The palette entry the role is painted with unless a tone says otherwise. */
  color: keyof Palette;
  /** How far the system text size may enlarge the role. Unset means without limit. */
  maxFontScale?: number;
}

/**
 * Line heights leave room for letterforms that sit taller than Latin ones.
 * The title is already large, so it stops growing at twice its size: beyond that
 * a single word no longer fits a phone's width and breaks in the middle.
 */
export const TYPE_ROLE: Record<TypeRoleName, TypeRole> = {
  screenTitle: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: '700',
    color: 'text',
    maxFontScale: 2,
  },
  sectionHeading: { fontSize: 18, lineHeight: 28, fontWeight: '600', color: 'text' },
  description: { fontSize: 15, lineHeight: 24, fontWeight: '400', color: 'textMuted' },
  body: { fontSize: 17, lineHeight: 28, fontWeight: '400', color: 'text' },
  label: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: 'text' },
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
