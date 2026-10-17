import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useSharedSingleFlight } from '@/hooks/useSingleFlight';
import { useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store/store';
import type { StaffOperation, ProofMethod } from '../types/staff-operation.types';
import { freshProofMethods } from '../utils/staffErrors';

export function useStaffOperation() {
  const store = useStore<RootState>();
  const auth = useAppSelector((state) => state.auth);
  const flight = useSharedSingleFlight();
  const pending = useRef<StaffOperation | null>(null);
  const startedSession = useRef(store.getState().auth);
  const [viewSession, setViewSession] = useState(() => store.getState().auth);
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
    async (operation: StaffOperation, retry: boolean) => {
      if (!isCurrent() || operation.isCurrent?.() === false) return;
      setBusy(true);
      setError(null);
      try {
        await operation.run();
        if (isCurrent() && operation.isCurrent?.() !== false) {
          pending.current = null;
          operation.onSuccess();
        }
      } catch (failure) {
        if (!isCurrent() || operation.isCurrent?.() === false) return;
        const offered = retry ? null : freshProofMethods(failure);
        if (offered) {
          pending.current = operation;
          setMethods(offered);
        } else {
          pending.current = null;
          await operation.onError?.(failure);
          if (isCurrent() && operation.isCurrent?.() !== false) setError(failure);
        }
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [isCurrent],
  );

  const start = useCallback(
    (operation: StaffOperation) =>
      flight(async () => {
        if (pending.current && isCurrent() && pending.current.isCurrent?.() !== false) return;
        pending.current = null;
        setMethods(null);
        const session = store.getState().auth;
        startedSession.current = session;
        setViewSession(session);
        await execute(operation, false);
      }),
    [execute, flight, isCurrent, store],
  );

  const proved = useCallback(
    () =>
      flight(async () => {
        const operation = pending.current;
        pending.current = null;
        setMethods(null);
        if (operation) await execute(operation, true);
      }),
    [execute, flight],
  );

  const cancelProof = useCallback(() => {
    pending.current = null;
    setMethods(null);
  }, []);
  const sameSession =
    auth.sessionGeneration === viewSession.sessionGeneration &&
    auth.user?.id === viewSession.user?.id;
  return {
    start,
    proved,
    cancelProof,
    methods: sameSession ? methods : null,
    busy: sameSession && busy,
    error: sameSession ? error : null,
    isCurrent,
  };
}
