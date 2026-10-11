'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl'; // feature:locale-ar
import { icuArgNames, type MessageValues } from '@/i18n/icu-args';

const UNKNOWN_ERROR = {
  en: 'An unexpected error occurred',
  ar: 'حدث خطأ غير متوقع', // feature:locale-ar
};

const UNKNOWN_ERROR_KEY = 'toast.error.unknownError';

export interface LocalizedToastMessageProps {
  messageKey: string;
  /** Shown when `messageKey` has no entry, or needs an argument `values` lacks. */
  fallbackKey?: string;
  values?: MessageValues;
}

/**
 * Resolves a message through the catalogue: the first of its key, its fallback
 * and the generic error that exists and has every argument it needs.
 */
export function useResolvedMessage(): (message: LocalizedToastMessageProps) => string {
  const t = useTranslations();
  const locale = useLocale(); // feature:locale-ar

  return useCallback(
    ({ messageKey, fallbackKey, values = {} }: LocalizedToastMessageProps) => {
      for (const key of [messageKey, fallbackKey, UNKNOWN_ERROR_KEY]) {
        if (key === undefined || !t.has(key)) continue;
        const raw: unknown = t.raw(key);
        if (typeof raw !== 'string') continue;
        if (icuArgNames(raw).every((name) => name in values)) return t(key, values);
      }
      if (locale === 'ar') return UNKNOWN_ERROR.ar; // feature:locale-ar
      return UNKNOWN_ERROR.en;
    },
    [
      t,
      locale, // feature:locale-ar
    ],
  );
}

/** Render middleware-generated keys within the Toaster's active locale context. */
export function LocalizedToastMessage(message: LocalizedToastMessageProps) {
  return useResolvedMessage()(message);
}
