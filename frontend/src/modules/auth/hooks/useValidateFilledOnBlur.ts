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
    // A submit moves the focus to the first invalid field before the form
    // renders as submitted, so the rendered `formState` is a step behind here
    // and the state is read where the library keeps it.
    const { isSubmitting, isSubmitted } = control._formState;
    if (isSubmitting || isSubmitted) return;
    if (getValues(name) === '') {
      clearErrors(name);
      return;
    }
    void trigger(name);
  }, [clearErrors, control, getValues, name, trigger]);
}
