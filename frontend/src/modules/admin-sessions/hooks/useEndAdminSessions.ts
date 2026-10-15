import { useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { SESSION_PERMISSIONS } from '@app/core';
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

interface Options {
  scope: AdminSessionScope;
  onSuccess: () => void;
  onUnknown: () => void;
}

export function useEndAdminSessions({ scope, onSuccess, onUnknown }: Options) {
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

  useEffect(() => {
    const currentScope = { actorId, sessionGeneration, userId };
    const unsubscribe = store.subscribe(() => {
      if (!sessionScopeIsCurrent(store.getState(), currentScope, SESSION_PERMISSIONS.DELETE_ALL)) {
        activeRequest.current?.abort();
      }
    });
    return () => {
      unsubscribe();
      activeRequest.current?.abort();
    };
  }, [store, actorId, sessionGeneration, userId]);

  const end = async (target: SessionEndTarget) => {
    if (
      sending.current ||
      unknown ||
      !sessionScopeIsCurrent(store.getState(), scope, SESSION_PERMISSIONS.DELETE_ALL)
    ) {
      return;
    }
    sending.current = true;
    setBusy(true);
    setRefusal(null);
    try {
      const request =
        'all' in target ? endAll(scope) : endOne({ ...scope, sessionId: target.session.id });
      activeRequest.current = request;
      if (!sessionScopeIsCurrent(store.getState(), scope, SESSION_PERMISSIONS.DELETE_ALL)) {
        request.abort();
      }
      await showsOwnRefusal(request).unwrap();
      if (sessionScopeIsCurrent(store.getState(), scope, SESSION_PERMISSIONS.DELETE_ALL)) {
        onSuccess();
      } else {
        setUnknown(true);
        onUnknown();
      }
    } catch (error) {
      if (
        !sessionScopeIsCurrent(store.getState(), scope, SESSION_PERMISSIONS.DELETE_ALL) ||
        hasUnknownOutcome(error)
      ) {
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
