import { SESSION_STATUS } from '../constants';
import { AuthSessionError } from '../errors/errors';
import { PortAbortController } from '../runtime/abort-controller';
import { raceWithAbort } from '../runtime/abortable';
import { waitForThrottle } from './refresh-helpers';
import type { AuthRuntime } from '../runtime/runtime';
import type { AbortSignalPort } from '../types/auth';
import type { RuntimeTokens } from '../types/record';

interface ActiveRefresh {
  epoch: number;
  promise?: Promise<RuntimeTokens> | undefined;
  waiters: number;
  waiting: boolean;
  waitController: PortAbortController;
}

export function createRefreshSingleFlight(
  runtime: AuthRuntime,
  performRefresh: (epoch: number, tokens: RuntimeTokens) => Promise<RuntimeTokens>,
): (signal?: AbortSignalPort) => Promise<RuntimeTokens> {
  let activeRefresh: ActiveRefresh | undefined;

  return (signal?: AbortSignalPort): Promise<RuntimeTokens> => {
    const currentTokens = runtime.tokens;
    if (!currentTokens || runtime.snapshot.status !== SESSION_STATUS.SIGNED_IN) {
      return Promise.reject(new AuthSessionError());
    }
    let operation = activeRefresh;
    if (!operation || operation.epoch !== runtime.epoch) {
      const epoch = runtime.epoch;
      const waitController = new PortAbortController();
      const next: ActiveRefresh = {
        epoch,
        promise: undefined,
        waiters: 0,
        waiting: true,
        waitController,
      };
      const pending = Promise.resolve()
        .then(() => waitForThrottle(runtime, epoch, waitController.signal))
        .then(() => {
          if (waitController.signal.aborted) throw new AuthSessionError();
          next.waiting = false;
          return performRefresh(epoch, currentTokens);
        });
      next.promise = pending;
      operation = next;
      activeRefresh = operation;
      void pending.then(
        () => {
          if (activeRefresh === operation) activeRefresh = undefined;
        },
        () => {
          if (activeRefresh === operation) activeRefresh = undefined;
        },
      );
    }
    if (!operation.promise) return Promise.reject(new AuthSessionError());
    const shared = operation.promise;
    operation.waiters += 1;
    const waiting = operation;
    return raceWithAbort(shared, signal).finally(() => {
      waiting.waiters -= 1;
      if (waiting.waiters === 0 && waiting.waiting) {
        waiting.waitController.abort();
        if (activeRefresh === waiting) activeRefresh = undefined;
      }
    });
  };
}
