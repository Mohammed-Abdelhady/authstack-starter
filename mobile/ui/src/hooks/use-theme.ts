import { useColorScheme } from 'react-native';
import { themeOf, type Theme } from '../logic/theme';

/** The palette and status bar style for the appearance the system is in now. */
export function useTheme(): Theme {
  return themeOf(useColorScheme());
}
