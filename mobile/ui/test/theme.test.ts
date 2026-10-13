import { describe, expect, it } from 'vitest';
import { themeOf } from '../src/logic/theme';
import { PALETTE } from '../src/theme/tokens';

describe('the theme for what the system reports', () => {
  it('paints with the dark palette and light bar icons in dark appearance', () => {
    const theme = themeOf('dark');

    expect(theme.scheme).toBe('dark');
    expect(theme.colors).toBe(PALETTE.dark);
    expect(theme.statusBarStyle).toBe('light-content');
  });

  it.each([['light'], ['unspecified'], [''], [null], [undefined]] as const)(
    'paints with the light palette and dark bar icons when the system reports %j',
    (reported) => {
      const theme = themeOf(reported);

      expect(theme.scheme).toBe('light');
      expect(theme.colors).toBe(PALETTE.light);
      expect(theme.statusBarStyle).toBe('dark-content');
    },
  );
});
