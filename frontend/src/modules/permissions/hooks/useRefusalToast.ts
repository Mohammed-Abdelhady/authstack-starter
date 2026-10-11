import { useMemo, useRef } from 'react';
import { toast } from '@/lib/toast';

export interface RefusalToast {
  /** Call when the server refuses the submit. Its error toast is raised elsewhere. */
  noteRefusal: () => void;
  /** Call before announcing success: takes down the toasts left by an earlier refusal. */
  clearBeforeSuccess: () => void;
}

/**
 * Keeps the error toast of a refused submit from staying on screen beside the
 * success toast of the corrected one. The store raises that error toast and
 * keeps no handle to it, so every toast on screen is dismissed, and only when
 * this form was refused since its last success.
 */
export function useRefusalToast(): RefusalToast {
  const refused = useRef(false);

  return useMemo(
    () => ({
      noteRefusal: () => {
        refused.current = true;
      },
      clearBeforeSuccess: () => {
        if (!refused.current) return;
        refused.current = false;
        toast.dismissAll();
      },
    }),
    [],
  );
}
