import { useCallback, useMemo, useState } from 'react';
import { REVOKE_RESULT } from '../constants';
import { useUi } from '../context/ui-context';
import { isApiFailure } from '../logic/request-failure';
import { sessionsView } from '../logic/session-rows';
import { deviceText, failureText } from '../logic/session-text';
import { useListSessionsQuery } from '../state/api';
import { revokeOtherSessions, revokeSession } from '../state/session-actions';
import type { SessionRow } from '../types';

interface Problem {
  title: string;
  description: string;
}

export function useSessions() {
  const { runtime, t, now, confirm } = useUi();
  const { currentData: data, error, refetch } = useListSessionsQuery();
  const [problem, setProblem] = useState<Problem>();
  // Only a pull shows the refresh indicator. The re-read after a sign-out stays quiet.
  const [pulling, setPulling] = useState(false);
  const failure = isApiFailure(error) ? error : undefined;
  // `now` is read when the list changes, not on every render.
  const view = useMemo(
    () => sessionsView({ sessions: data, failure, now: now() }),
    [data, failure, now],
  );

  const refresh = useCallback(() => {
    setProblem(undefined);
    setPulling(true);
    void refetch().then(() => setPulling(false));
  }, [refetch]);

  const revoke = useCallback(
    async (row: SessionRow) => {
      const device = deviceText(t, row.device);
      const ask = () =>
        confirm({
          title: t('sessions.confirmRevoke.title', { device }),
          message: t('sessions.confirmRevoke.message'),
          confirmLabel: t('sessions.revoke'),
          cancelLabel: t('common.cancel'),
        });
      setProblem(undefined);
      const result = await revokeSession(runtime, row, ask);
      if (result !== REVOKE_RESULT.UNDONE) return;
      setProblem({
        title: t('sessions.revokeFailed.title', { device }),
        description: t('sessions.revokeFailed.description'),
      });
    },
    [confirm, runtime, t],
  );

  const revokeOthers = useCallback(async () => {
    const ask = () =>
      confirm({
        title: t('sessions.confirmOthers.title'),
        message: t('sessions.confirmOthers.message'),
        confirmLabel: t('sessions.revokeOthers'),
        cancelLabel: t('common.cancel'),
      });
    setProblem(undefined);
    if ((await revokeOtherSessions(runtime, ask)) !== REVOKE_RESULT.UNDONE) return;
    setProblem({
      title: t('sessions.revokeOthersFailed.title'),
      description: t('sessions.revokeOthersFailed.description'),
    });
  }, [confirm, runtime, t]);

  return {
    ...view,
    failureText: failureText(t, view.failure),
    problem,
    refreshing: pulling,
    refresh,
    revoke: useCallback((row: SessionRow) => void revoke(row), [revoke]),
    revokeOthers: useCallback(() => void revokeOthers(), [revokeOthers]),
  };
}
