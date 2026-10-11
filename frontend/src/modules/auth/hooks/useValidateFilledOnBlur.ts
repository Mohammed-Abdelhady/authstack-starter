'use client';

import { useCallback } from 'react';
import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

/**
 * Blur handler for a form that shares its page with another way to sign in,
 * used with the `onSubmit` validation mode.
 *
 * Leaving an empty field is not a mistake: the person may be on their way to
 * the other form. A field with something typed in it is checked as it is
 * left, and emptying it again takes that message away. Once a submit has
 * started the library owns the messages and revalidates on change, so blur
 * stays out of it.
 */
export function useValidateFilledOnBlur<TFieldValues extends FieldValues>(
  form: UseFormReturn<TFieldValues>,
  name: FieldPath<TFieldValues>,
): () => void {
  const { getValues, trigger, clearErrors, control } = form;

  return useCallback(() => {
    // The public `formState` is only as fresh as the last render, and a submit
    // moves the focus before the form renders as submitted. The control holds
    // the live flags, so this does not depend on a render landing in between.
    // `__tests__/useValidateFilledOnBlur.test.tsx` fails if the library moves them.
    const { isSubmitting, isSubmitted } = control._formState;
    if (isSubmitting || isSubmitted) return;
    if (getValues(name) === '') {
      clearErrors(name);
      return;
    }
    void trigger(name);
  }, [clearErrors, control, getValues, name, trigger]);
}
