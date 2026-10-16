import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useSingleFlight } from '@/hooks/useSingleFlight';
import type { RootState } from '@/store/store';
import type { InvitationOperation, ProofMethod } from '../types/invitation.types';
import { freshProofMethods } from '../utils/invitationErrors';

export function useInvitationOperation() {
  const store = useStore<RootState>();
  const pending = useRef<InvitationOperation | null>(null);
  const startedSession = useRef(store.getState().auth);
  const mounted = useRef(false);
  const [methods, setMethods] = useState<ProofMethod[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const isCurrent = useCallback(() => {
    const auth = store.getState().auth;
    return (
      mounted.current &&
      auth.sessionGeneration === startedSession.current.sessionGeneration &&
      auth.user?.id === startedSession.current.user?.id
    );
  }, [store]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
    };
  }, []);

  const execute = useCallback(
    async (operation: InvitationOperation, retry: boolean) => {
      if (!isCurrent()) return;
      setBusy(true);
      setError(null);
      try {
        await operation.run();
        if (isCurrent()) {
          pending.current = null;
          operation.onSuccess();
        }
      } catch (failure) {
        if (!isCurrent()) return;
        const offered = retry ? null : freshProofMethods(failure);
        if (offered) {
          pending.current = operation;
          setMethods(offered);
        } else {
          pending.current = null;
          setError(failure);
        }
      } finally {
        if (isCurrent()) setBusy(false);
      }
    },
    [isCurrent],
  );

  const start = useSingleFlight(
    useCallback(
      async (operation: InvitationOperation) => {
        if (pending.current) return;
        startedSession.current = store.getState().auth;
        await execute(operation, false);
      },
      [execute, store],
    ),
  );

  const proved = useSingleFlight(
    useCallback(async () => {
      const operation = pending.current;
      pending.current = null;
      setMethods(null);
      if (operation) await execute(operation, true);
    }, [execute]),
  );

  const cancelProof = useCallback(() => {
    pending.current = null;
    setMethods(null);
  }, []);
  return { start, proved, cancelProof, methods, busy, error };
}
