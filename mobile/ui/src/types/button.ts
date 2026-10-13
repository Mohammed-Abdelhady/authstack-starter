import type { BUTTON_VARIANT } from '../constants/button';

export type ButtonVariant = (typeof BUTTON_VARIANT)[keyof typeof BUTTON_VARIANT];
