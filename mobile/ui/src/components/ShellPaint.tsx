import { useMemo, type ReactNode } from 'react';
import { PaintContext, type Paint } from '../context/paint-context';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import { useTheme } from '../hooks/use-theme';
import type { Direction } from '../i18n';

/** Lets a shell draw the shared text and buttons on a surface of its own, outside the screens. */
export function ShellPaint({ direction, children }: { direction: Direction; children: ReactNode }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const paint = useMemo<Paint>(
    () => ({ colors, direction, reduceMotion }),
    [colors, direction, reduceMotion],
  );
  return <PaintContext.Provider value={paint}>{children}</PaintContext.Provider>;
}
