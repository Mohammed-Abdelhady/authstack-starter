import type { BrowserSignInOptions } from '@app/native-auth';
import { SIGN_IN_FAILURE, SIGN_IN_ACTION, type SignInAction } from '../constants';
import type { EnginePort, SignInAttempt } from '../types';

export interface SignInController {
  getState(): SignInAttempt;
  subscribe(listener: () => void): () => void;
  /** Starts sign-in, or a restore when storage was locked. Does nothing while one is running. */
  run(action: SignInAction, options?: BrowserSignInOptions): void;
  /** Forgets how the last attempt ended. */
  clear(): void;
}

const IDLE: SignInAttempt = { pending: false };

export function createSignInController(
  engine: Pick<EnginePort, 'signIn' | 'restore'>,
): SignInController {
  let state = IDLE;
  const listeners = new Set<() => void>();

  const set = (next: SignInAttempt): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const attempt = async (
    action: SignInAction,
    options?: BrowserSignInOptions,
  ): Promise<SignInAttempt> => {
    if (action === SIGN_IN_ACTION.RESTORE) {
      const result = await engine.restore();
      return result.kind === 'storageBlocked' ? { pending: false, blocked: result.reason } : IDLE;
    }
    return { pending: false, outcome: await engine.signIn(options) };
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    run(action, options) {
      if (state.pending) return;
      set({ pending: true, action });
      void attempt(action, options).then(set, () =>
        set({ pending: false, failure: SIGN_IN_FAILURE.GENERIC }),
      );
    },
    clear() {
      if (
        !state.pending &&
        (state.outcome !== undefined || state.failure !== undefined || state.blocked !== undefined)
      )
        set(IDLE);
    },
  };
}
