import { useCallback, useState } from 'react';
import { LIST_VIEW, SIGN_OUT_STATE, type SignOutState } from '../constants';
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
  const [signOutState, setSignOutState] = useState<SignOutState>(SIGN_OUT_STATE.IDLE);
  const signOut = useCallback(() => {
    setSignOutState(SIGN_OUT_STATE.PENDING);
    void engine.signOut().then(
      // Only a finished sign-out is success; one that was not saved leaves the person signed in.
      (outcome) =>
        setSignOutState(outcome.kind === 'signedOut' ? SIGN_OUT_STATE.IDLE : SIGN_OUT_STATE.FAILED),
      () => setSignOutState(SIGN_OUT_STATE.FAILED),
    );
  }, [engine]);

  const view = data !== undefined ? LIST_VIEW.READY : failure ? LIST_VIEW.ERROR : LIST_VIEW.LOADING;
  return {
    view,
    profile: data === undefined ? undefined : profileText(t, data),
    failureText: failureText(t, failure),
    sessionNotSaved: snapshot.warning === 'storageBlocked',
    retry,
    signOut,
    signOutState,
  };
}
