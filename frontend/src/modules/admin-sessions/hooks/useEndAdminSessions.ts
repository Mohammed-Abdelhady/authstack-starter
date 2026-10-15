import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { SESSION_PERMISSIONS, type RoleAudience } from '@app/core';
import { useRefusalText } from '@/hooks/useRefusalText';
import { showsOwnRefusal } from '@/lib/refusal';
import type { RootState } from '@/store/store';
import {
  useEndAdminSessionMutation,
  useEndAllAdminSessionsMutation,
} from '../api/adminSessionsApi';
import type { AdminSessionScope, SessionEndTarget } from '../types/admin-session.types';
import { hasUnknownOutcome } from '../utils/unknownOutcome';
import { sessionScopeIsCurrent } from '../utils/sessionScopeIsCurrent';
import { canEndSessions } from '../utils/canEndSessions';

interface Options {
  scope: AdminSessionScope;
  targetClass: RoleAudience | undefined;
  onSuccess: () => void;
  onUnknown: () => void;
}

export function useEndAdminSessions({ scope, targetClass, onSuccess, onUnknown }: Options) {
  const store = useStore<RootState>();
  const refusalText = useRefusalText();
  const [endOne] = useEndAdminSessionMutation();
  const [endAll] = useEndAllAdminSessionsMutation();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const sending = useRef(false);
  const activeRequest = useRef<{ abort: () => void } | null>(null);
  const { actorId, sessionGeneration, userId } = scope;

  const canEndCurrentScope = useCallback(() => {
    const state = store.getState();
    return (
      sessionScopeIsCurrent(
        state,
        { actorId, sessionGeneration, userId },
        SESSION_PERMISSIONS.DELETE_ALL,
      ) && canEndSessions(state.auth.user?.permissions ?? [], targetClass)
    );
  }, [store, actorId, sessionGeneration, userId, targetClass]);

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      if (!canEndCurrentScope()) {
        activeRequest.current?.abort();
      }
    });
    return () => {
      unsubscribe();
      activeRequest.current?.abort();
    };
  }, [store, canEndCurrentScope]);

  const end = async (target: SessionEndTarget) => {
    if (sending.current || unknown || !canEndCurrentScope()) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const request =
        'all' in target ? endAll(scope) : endOne({ ...scope, sessionId: target.session.id });
      activeRequest.current = request;
      if (!canEndCurrentScope()) {
        request.abort();
      }
      await showsOwnRefusal(request).unwrap();
      if (canEndCurrentScope()) {
        onSuccess();
      } else {
        setUnknown(true);
        onUnknown();
      }
    } catch (error) {
      if (!canEndCurrentScope() || hasUnknownOutcome(error)) {
        setUnknown(true);
        onUnknown();
      } else {
        setRefusal(refusalText(error));
      }
    } finally {
      activeRequest.current = null;
      sending.current = false;
      setBusy(false);
    }
  };

  return { end, busy, refusal, unknown };
}
