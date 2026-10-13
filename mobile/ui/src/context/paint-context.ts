import { createContext, useContext } from 'react';
import type { Direction } from '../i18n';
import type { Palette } from '../types/theme';

/** What a text or a button needs to draw itself, inside the screens or on a shell's own surface. */
export interface Paint {
  colors: Palette;
  direction: Direction;
  reduceMotion: boolean;
  fontsReady?: boolean;
}

export const PaintContext = createContext<Paint | undefined>(undefined);

export function usePaint(): Paint {
  const paint = useContext(PaintContext);
  if (paint === undefined)
    throw new Error('A text or a button was rendered outside NativeApp and ShellPaint.');
  return paint;
}
