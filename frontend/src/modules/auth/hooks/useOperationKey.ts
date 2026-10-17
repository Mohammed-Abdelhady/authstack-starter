import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import type { RootState } from '@/store/store';

export function useOperationKey() {
  const store = useStore<RootState>();
  const logical = useRef<{ signature: string; key: string } | null>(null);
  useEffect(
    () => () => {
      logical.current = null;
    },
    [],
  );
  const forBody = useCallback(
    (body: object): string => {
      const auth = store.getState().auth;
      const signature = JSON.stringify([auth.user?.id, auth.sessionGeneration, body]);
      const current = logical.current;
      if (current?.signature === signature) return current.key;
      const key = crypto.randomUUID();
      logical.current = { signature, key };
      return key;
    },
    [store],
  );
  const reset = useCallback(() => {
    logical.current = null;
  }, []);
  return { forBody, reset };
}
