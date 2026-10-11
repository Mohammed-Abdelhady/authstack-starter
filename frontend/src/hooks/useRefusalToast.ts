import { useMemo, useRef } from 'react';
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
 */
export function useRefusalToast(): RefusalToast {
  const refused = useRef(false);

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
