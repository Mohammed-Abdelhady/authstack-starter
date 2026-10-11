import { useEffect, useMemo, useRef } from 'react';
import { toast } from '@/lib/toast';

export interface RefusalToast {
  /** Call when the server refuses the submit. Its error toast is raised elsewhere. */
  noteRefusal: () => void;
  /**
   * Call when the form is sent again, or before announcing success: takes down
   * the toasts left by an earlier refusal.
   */
  clearStale: () => void;
}

/**
 * Keeps the error toast of a refused submit from staying on screen once the
 * form has been sent again, beside the success toast or a different message
 * on a field. The store raises that error toast and keeps no handle to it, so
 * every toast on screen is dismissed, and only when this form was refused
 * since it last cleared.
 *
 * @param isOpen - For a form in a dialog: whether the dialog is open. The
 * toast of its refusal goes when the dialog closes, so it cannot show beside
 * the refusal of the next dialog.
 */
export function useRefusalToast(isOpen = true): RefusalToast {
  const refused = useRef(false);

  useEffect(() => {
    if (isOpen || !refused.current) return;
    refused.current = false;
    toast.dismissAll();
  }, [isOpen]);

  return useMemo(
    () => ({
      noteRefusal: () => {
        refused.current = true;
      },
      clearStale: () => {
        if (!refused.current) return;
        refused.current = false;
        toast.dismissAll();
      },
    }),
    [],
  );
}
