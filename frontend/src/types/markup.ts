import type { UNSAFE_MARKUP_PROP } from '@/lib/unsafeMarkup';

export type UnsafeMarkupProp = typeof UNSAFE_MARKUP_PROP;

export type SafeMarkupProps<T extends object> = Omit<T, UnsafeMarkupProp>;
