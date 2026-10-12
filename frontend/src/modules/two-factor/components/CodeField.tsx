'use client';

import { useTranslations } from 'next-intl';
import { useCallback, type ChangeEvent } from 'react';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FormInput } from '@/components/forms';
import { filterDigits } from '@/modules/auth/utils/digitFilter';
import { TOTP_CODE_LENGTH } from '../constants';
import { CODE_ENTRY_FONT_SIZE } from '@/lib/config/form-styles';
import { cn } from '@/lib/utils';

interface CodeFieldProps<TFieldValues extends FieldValues> {
  name: FieldPath<TFieldValues>;
  label: string;
  /** The request of its form is running. */
  busy?: boolean;
  autoFocus?: boolean;
  testId: string;
}

/**
 * The six digit box. Everything but digits is dropped as it is typed, so a
 * code pasted with spaces from an authenticator app still submits.
 */
export function CodeField<TFieldValues extends FieldValues>({
  name,
  label,
  busy,
  autoFocus,
  testId,
}: CodeFieldProps<TFieldValues>) {
  const tCommon = useTranslations('common');
  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    event.target.value = filterDigits(event.target.value, TOTP_CODE_LENGTH);
  }, []);

  return (
    <FormInput<TFieldValues>
      name={name}
      label={label}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      required
      placeholder={tCommon('codePlaceholder')}
      busy={busy}
      autoFocus={autoFocus}
      onChange={onChange}
      className={cn('text-center tracking-widest', CODE_ENTRY_FONT_SIZE)}
      data-testid={testId}
    />
  );
}
