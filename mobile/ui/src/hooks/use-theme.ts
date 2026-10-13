import { useColorScheme } from 'react-native';
import { themeOf } from '../logic/theme';
import type { Theme } from '../types/theme';

/** The palette and status bar style for the appearance the system is in now. */
export function useTheme(): Theme {
  return themeOf(useColorScheme());
}
