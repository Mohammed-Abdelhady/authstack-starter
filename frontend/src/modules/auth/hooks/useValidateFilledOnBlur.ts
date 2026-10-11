'use client';

import { useCallback } from 'react';
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

/**
 * Blur handler for a form that shares its page with another way to sign in,
 * used with the `onSubmit` validation mode.
 *
 * Leaving an empty field is not a mistake: the person may be on their way to
 * the other form. A field with something typed in it is checked as it is
 * left, and emptying it again takes that message away. Once the form has been
 * submitted the library revalidates on change, so blur stays out of it.
 */
export function useValidateFilledOnBlur<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  name: FieldPath<TFieldValues>,
): () => void {
  const { getValues, trigger, clearErrors } = form;
  const { isSubmitted } = form.formState;

  return useCallback(() => {
    if (isSubmitted) return;
    if (getValues(name) === '') {
      clearErrors(name);
      return;
    }
    void trigger(name);
  }, [clearErrors, getValues, isSubmitted, name, trigger]);
}
