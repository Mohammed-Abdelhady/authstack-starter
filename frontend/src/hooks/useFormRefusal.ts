import { useCallback, useMemo, useState } from 'react';
import { refusedField } from '@/lib/refusal';
import { useRefusalText } from './useRefusalText';
import {
  SERVER_FIELD_ERROR_TYPE,
  useFocusFieldAfterSubmit,
  useServerFieldErrors,
  type ServerFieldErrorTarget,
} from './useServerFieldErrors';

export interface FormRefusal {
  /** The refusal that names no field, for the form's alert. Null when there is none. */
  alert: string | null;
  /** Call as the form is sent again, and when its dialog closes. */
  clear: () => void;
  /** Shows what the request failed with: on the field it names, or in the alert. */
  show: (error: unknown) => void;
}

/**
 * Where a form shows a refused submit. A refusal that names a field marks
 * that field with the server's reason and gives it the focus. Any other
 * refusal is the form's alert. Send the request through `showsOwnRefusal`,
 * so the reason is said once, here, and not in a toast as well.
 *
 * @example
 * ```tsx
 * const refusal = useFormRefusal(target, isLoading);
 *
 * refusal.clear();
 * try {
 *   await showsOwnRefusal(save(data)).unwrap();
 * } catch (error) {
 *   refusal.show(error);
 *   reportUnlessHandled(error);
 * }
 *
 * <FormRootError error={refusal.alert} />
 * ```
 */
export function useFormRefusal(target: ServerFieldErrorTarget, isSubmitting: boolean): FormRefusal {
  const { getFieldElement, setError } = target;
  const applyServerFieldErrors = useServerFieldErrors(target, isSubmitting);
  const focusField = useFocusFieldAfterSubmit(getFieldElement, isSubmitting);
  const refusalText = useRefusalText();
  const [alert, setAlert] = useState<string | null>(null);

  const clear = useCallback(() => setAlert(null), []);

  const show = useCallback(
    (error: unknown) => {
      if (applyServerFieldErrors(error)) return;
      const field = refusedField(error);
      const message = refusalText(error);
      if (field !== undefined && getFieldElement(field) !== null) {
        setError(field, { type: SERVER_FIELD_ERROR_TYPE, message });
        focusField(field);
        return;
      }
      setAlert(message);
    },
    [applyServerFieldErrors, focusField, getFieldElement, refusalText, setError],
  );

  return useMemo(() => ({ alert, clear, show }), [alert, clear, show]);
}

const NO_FIELDS: ServerFieldErrorTarget = {
  getFieldElement: () => null,
  setError: () => undefined,
};

/** The same for a confirmation, which has no field to mark. */
export function useDialogRefusal(): FormRefusal {
  return useFormRefusal(NO_FIELDS, false);
}
