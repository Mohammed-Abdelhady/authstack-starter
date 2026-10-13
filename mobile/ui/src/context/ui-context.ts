import type { ComponentType } from 'react';
import type { NativeProviderButtonProps } from '../types/native-sign-in';
import { createContext, useContext } from 'react';
import type { Direction, Locale, Translate } from '../i18n';
import type { UiRuntime } from '../state/runtime';
import type { Palette } from '../theme/tokens';
import type { Confirm, EdgeInsets } from '../types';

export interface Ui {
  colors: Palette;
  direction: Direction;
  locale: Locale;
  t: Translate;
  reduceMotion: boolean;
  insets: EdgeInsets;
  runtime: UiRuntime;
  now: () => number;
  confirm: Confirm;
  appName: string;
  providerButton?: ComponentType<NativeProviderButtonProps>;
}

export const UiContext = createContext<Ui | undefined>(undefined);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (ui === undefined) throw new Error('A screen was rendered outside NativeApp.');
  return ui;
}
