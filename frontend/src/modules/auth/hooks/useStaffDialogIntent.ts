import { useCallback, useLayoutEffect, useRef } from 'react';

export function useStaffDialogIntent(open: boolean, target: string | null) {
  const state = useRef({ open, target, revision: 0, mounted: false });
  useLayoutEffect(() => {
    const current = state.current;
    current.open = open;
    current.target = target;
    current.mounted = true;
    return () => {
      current.mounted = false;
      current.revision += 1;
    };
  }, [open, target]);
  const capture = useCallback(() => {
    const revision = state.current.revision;
    return () => state.current.mounted && state.current.open && state.current.revision === revision;
  }, []);
  const invalidate = useCallback(() => {
    state.current.revision += 1;
  }, []);
  return { capture, invalidate };
}
