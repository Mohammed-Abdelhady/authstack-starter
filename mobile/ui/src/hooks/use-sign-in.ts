import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useUi } from '../context/ui-context';
import { isProblem, signInActionText, signInNotice } from '../logic/sign-in-text';
import { signInView } from '../logic/sign-in-view';
import { useEngineSnapshot } from './use-engine-snapshot';

export function useSignIn() {
  const { runtime, t, locale } = useUi();
  const { signIn, engine } = runtime;
  const snapshot = useEngineSnapshot(engine);
  const attempt = useSyncExternalStore(signIn.subscribe, signIn.getState);
  const view = useMemo(() => signInView(snapshot, attempt), [snapshot, attempt]);
  const notice = signInNotice(view);
  const act = useCallback(() => signIn.run(view.action, { locale }), [locale, signIn, view.action]);

  return {
    canAct: view.canAct,
    actionLabel: t(signInActionText(view)),
    notice:
      notice === undefined
        ? undefined
        : { title: t(notice.title), description: t(notice.description), problem: isProblem(view) },
    act,
  };
}
