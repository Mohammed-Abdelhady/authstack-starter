import latin400 from '../../assets/fonts/AppUISans-400.ttf';
import latin500 from '../../assets/fonts/AppUISans-500.ttf';
import latin600 from '../../assets/fonts/AppUISans-600.ttf';
import latin800 from '../../assets/fonts/AppUISans-800.ttf';
import arabic400 from '../../assets/fonts/AppUIArabic-400.ttf'; // feature:locale-ar
import arabic500 from '../../assets/fonts/AppUIArabic-500.ttf'; // feature:locale-ar
import arabic600 from '../../assets/fonts/AppUIArabic-600.ttf'; // feature:locale-ar
import arabic800 from '../../assets/fonts/AppUIArabic-800.ttf'; // feature:locale-ar

const LATIN_FAMILY = {
  400: 'AppUISans-Regular',
  500: 'AppUISans-Medium',
  600: 'AppUISans-SemiBold',
  800: 'AppUISans-ExtraBold',
} as const;

const RTL_FAMILY = {
  ...LATIN_FAMILY,
  // feature:locale-ar:start
  400: 'AppUIArabic-Regular',
  500: 'AppUIArabic-Medium',
  600: 'AppUIArabic-SemiBold',
  800: 'AppUIArabic-ExtraBold',
  // feature:locale-ar:end
} as const;

export const FONT_FAMILY = { ltr: LATIN_FAMILY, rtl: RTL_FAMILY } as const;

export const FONT_SOURCES = {
  [FONT_FAMILY.ltr[400]]: latin400,
  [FONT_FAMILY.ltr[500]]: latin500,
  [FONT_FAMILY.ltr[600]]: latin600,
  [FONT_FAMILY.ltr[800]]: latin800,
  [FONT_FAMILY.rtl[400]]: arabic400, // feature:locale-ar
  [FONT_FAMILY.rtl[500]]: arabic500, // feature:locale-ar
  [FONT_FAMILY.rtl[600]]: arabic600, // feature:locale-ar
  [FONT_FAMILY.rtl[800]]: arabic800, // feature:locale-ar
} as const;
