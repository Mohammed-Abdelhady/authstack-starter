import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useTranslations } from 'next-intl';
import type { ErrorOption, FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ErrorCode, getErrorCodeTranslationKey, getFieldErrors } from '@app/core';

export const SERVER_FIELD_ERROR_TYPE = 'server';

/** The server's own messages are English only, so every marked field shows this one. */
export const SERVER_FIELD_ERROR_MESSAGE_KEY = getErrorCodeTranslationKey(ErrorCode.INVALID_INPUT);

/** What marking fields needs from a form. Keep it stable between renders. */
export interface ServerFieldErrorTarget {
  /** The control of a field, or null when the form has no field of that name. */
  getFieldElement: (name: string) => HTMLElement | null;
  /** Called only with a name `getFieldElement` found a control for. */
  setError: (name: string, error: ErrorOption) => void;
}

/**
 * The target of a react-hook-form form: fields are found by their `name`
 * inside the form element.
 *
 * @example
 * ```tsx
 * const formRef = useRef<HTMLFormElement>(null);
 * const target = useFormFieldTarget(form.setError, formRef);
 * return <form ref={formRef}>...</form>;
 * ```
 */
export function useFormFieldTarget<TValues extends FieldValues>(
  setError: UseFormSetError<TValues>,
  formRef: RefObject<HTMLFormElement | null>,
): ServerFieldErrorTarget {
  return useMemo(() => {
    const getFieldElement = (name: string): HTMLElement | null => {
      const control = formRef.current?.elements.namedItem(name);
      return control instanceof HTMLElement ? control : null;
    };
    const isFieldPath = (name: string): name is Path<TValues> => getFieldElement(name) !== null;
    return {
      getFieldElement,
      setError: (name, error) => {
        if (isFieldPath(name)) setError(name, error);
      },
    };
  }, [setError, formRef]);
}

/** The element id of a field in a form that names its controls by id. */
export function fieldElementId(idPrefix: string, name: string): string {
  return `${idPrefix}-${name}`;
}

/**
 * The target of a form that keeps its errors in local state and gives each
 * control the id `fieldElementId(idPrefix, name)`.
 */
export function useLocalFieldTarget(
  setErrors: Dispatch<SetStateAction<Record<string, string>>>,
  idPrefix: string,
): ServerFieldErrorTarget {
  return useMemo(
    () => ({
      getFieldElement: (name) => document.getElementById(fieldElementId(idPrefix, name)),
      setError: (name, error) => setErrors((prev) => ({ ...prev, [name]: error.message ?? '' })),
    }),
    [setErrors, idPrefix],
  );
}

function inDocumentOrder(a: HTMLElement, b: HTMLElement): number {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * Marks the fields a rejected mutation names in `details.fields` and focuses
 * the first of them as they appear on screen. Names the form has no control
 * for are ignored. Returns whether any field was marked.
 *
 * @param isSubmitting - The flag that holds the fields while the request runs
 *
 * @example
 * ```tsx
 * const applyServerFieldErrors = useServerFieldErrors(target, isLoading);
 *
 * try {
 *   await save(data).unwrap();
 * } catch (error) {
 *   applyServerFieldErrors(error);
 *   reportUnlessHandled(error);
 * }
 * ```
 */
export function useServerFieldErrors(
  { getFieldElement, setError }: ServerFieldErrorTarget,
  isSubmitting: boolean,
): (error: unknown) => boolean {
  const t = useTranslations();
  const [focusRequest, setFocusRequest] = useState<{ name: string } | null>(null);
  const focusedRequest = useRef<{ name: string } | null>(null);

  // The fields are held while the request runs, and the store reports its end
  // a frame after the rejection reaches the form.
  useEffect(() => {
    if (focusRequest === null || isSubmitting || focusedRequest.current === focusRequest) return;
    focusedRequest.current = focusRequest;
    getFieldElement(focusRequest.name)?.focus();
  }, [focusRequest, isSubmitting, getFieldElement]);

  return useCallback(
    (error: unknown): boolean => {
      const fieldErrors = getFieldErrors(error);
      if (!fieldErrors) return false;

      const marked = Object.keys(fieldErrors)
        .flatMap((name) => {
          const element = getFieldElement(name);
          return element ? [{ name, element }] : [];
        })
        .sort((a, b) => inDocumentOrder(a.element, b.element));
      const first = marked[0];
      if (first === undefined) return false;

      const message = t(SERVER_FIELD_ERROR_MESSAGE_KEY);
      for (const { name } of marked) {
        setError(name, { type: SERVER_FIELD_ERROR_TYPE, message });
      }
      setFocusRequest({ name: first.name });
      return true;
    },
    [getFieldElement, setError, t],
  );
}
