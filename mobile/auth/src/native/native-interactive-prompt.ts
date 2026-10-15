import { TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import { BROWSER_AUTHORIZATION_TIMEOUT_MS } from '../constants';
import { AuthDisposedError } from '../errors/errors';
import { PortDeadlineError, withPortDeadline } from '../runtime/deadlines';
import type { AuthRuntime } from '../runtime/runtime';
import type { Unsubscribe } from '../types/auth';
import type {
  NativeInteractivePrompt,
  NativeInteractivePromptRequest,
  NativePromptResult,
} from '../types/passkey-port';

export function createNativeInteractivePrompt(runtime: AuthRuntime): NativeInteractivePrompt {
  let active = false;
  return <T>({ controller, expiresAt, start }: NativeInteractivePromptRequest<T>) => {
    if (runtime.disposed) return Promise.reject(new AuthDisposedError());
    if (controller.signal.aborted)
      return Promise.reject(new TransportError(TRANSPORT_FAILURE.ABORTED));
    if (active) return Promise.resolve({ kind: 'unavailable' as const });
    const startedAt = runtime.wallTime();
    const remaining = Math.min(BROWSER_AUTHORIZATION_TIMEOUT_MS, expiresAt - startedAt);
    const effectiveExpiry = startedAt + remaining;
    if (remaining <= 0) return Promise.resolve({ kind: 'expired' as const });

    active = true;
    let expired = false;
    let rejectCancellation: (error: unknown) => void = () => undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const onAbort = (): void => {
      if (!expired) rejectCancellation(new TransportError(TRANSPORT_FAILURE.ABORTED));
    };
    controller.signal.addEventListener('abort', onAbort);
    const unsubscribeDispose = runtime.onDispose(() => {
      rejectCancellation(new AuthDisposedError());
      controller.abort();
    });
    const physical = Promise.resolve()
      .then<NativePromptResult<T> | { kind: 'expired' }>(() => {
        if (controller.signal.aborted) throw new TransportError(TRANSPORT_FAILURE.ABORTED);
        if (runtime.wallTime() >= effectiveExpiry) return { kind: 'expired' as const };
        return start();
      })
      .then((result) =>
        runtime.wallTime() >= effectiveExpiry ? { kind: 'expired' as const } : result,
      );
    void physical.then(
      () => {
        active = false;
      },
      () => {
        active = false;
      },
    );
    let cancelDeadline: Unsubscribe = () => undefined;
    const bounded = withPortDeadline(
      {
        after: (milliseconds, callback) => {
          const cancel = runtime.dependencies.timer.after(milliseconds, callback);
          let cancelledTimer = false;
          cancelDeadline = () => {
            if (cancelledTimer) return;
            cancelledTimer = true;
            cancel();
          };
          return cancelDeadline;
        },
      },
      remaining,
      () => physical,
      'native.prompt',
      () => {
        expired = true;
        controller.abort();
      },
    );
    return Promise.race([bounded, cancelled])
      .catch((error: unknown): NativePromptResult<T> | { kind: 'expired' } => {
        if (expired && error instanceof PortDeadlineError) return { kind: 'expired' };
        throw error;
      })
      .finally(() => {
        try {
          cancelDeadline();
        } catch {
          /* Lifecycle listeners still need removal. */
        }
        controller.signal.removeEventListener('abort', onAbort);
        unsubscribeDispose();
      });
  };
}
