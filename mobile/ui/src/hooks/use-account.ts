import { useCallback } from 'react';
import { LIST_VIEW } from '../constants';
import { useUi } from '../context/ui-context';
import { isApiFailure } from '../logic/request-failure';
import { failureText, profileText } from '../logic/session-text';
import { useGetProfileQuery } from '../state/api';
import { useEngineSnapshot } from './use-engine-snapshot';

export function useAccount() {
  const { runtime, t } = useUi();
  const { engine } = runtime;
  const snapshot = useEngineSnapshot(engine);
  const { data, error, refetch } = useGetProfileQuery();
  const failure = isApiFailure(error) ? error : undefined;
  const retry = useCallback(() => void refetch(), [refetch]);
  const signOut = useCallback(() => void engine.signOut().catch(() => undefined), [engine]);

  const view = data !== undefined ? LIST_VIEW.READY : failure ? LIST_VIEW.ERROR : LIST_VIEW.LOADING;
  return {
    view,
    profile: data === undefined ? undefined : profileText(t, data),
    failureText: failureText(t, failure),
    sessionNotSaved: snapshot.warning === 'storageBlocked',
    retry,
    signOut,
  };
}
