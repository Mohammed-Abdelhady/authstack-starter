import type { AbortSignalPort, NativePromptResult } from '@app/native-auth';

const CANCELLED: NativePromptResult<never> = { kind: 'cancelled' };
const UNAVAILABLE: NativePromptResult<never> = { kind: 'unavailable' };
const SDK_FAILURE: NativePromptResult<never> = { kind: 'failed', reason: 'sdk' };

export interface NativePromptLease {
  run<TRaw, TValue>(
    signal: AbortSignalPort,
    start: () => Promise<TRaw>,
    accept: (raw: TRaw) => NativePromptResult<TValue>,
    reject: (error: unknown) => NativePromptResult<TValue>,
  ): Promise<NativePromptResult<TValue>>;
}

/** Holds one shared lease until the native SDK promise settles, even after abort. */
export function createNativePromptLease(): NativePromptLease {
  let active = false;

  return {
    run<TRaw, TValue>(
      signal: AbortSignalPort,
      start: () => Promise<TRaw>,
      accept: (raw: TRaw) => NativePromptResult<TValue>,
      reject: (error: unknown) => NativePromptResult<TValue>,
    ) {
      if (signal.aborted) return Promise.resolve(CANCELLED);
      if (active) return Promise.resolve(UNAVAILABLE);

      active = true;
      let aborted = false;
      let resolveCaller: (result: NativePromptResult<TValue>) => void = () => undefined;
      const callerResult = new Promise<NativePromptResult<TValue>>((resolve) => {
        resolveCaller = resolve;
      });
      const onAbort = () => {
        if (aborted) return;
        aborted = true;
        signal.removeEventListener('abort', onAbort);
        resolveCaller(CANCELLED);
      };

      signal.addEventListener('abort', onAbort);
      if (signal.aborted) {
        onAbort();
        active = false;
        return callerResult;
      }

      let nativeOperation: Promise<TRaw>;
      try {
        nativeOperation = Promise.resolve(start());
      } catch (error) {
        nativeOperation = Promise.reject(error);
      }

      const release = () => {
        signal.removeEventListener('abort', onAbort);
        active = false;
      };
      const resolveAfterRelease = (result: NativePromptResult<TValue>) => {
        release();
        if (!aborted) resolveCaller(result);
      };

      void nativeOperation.then(
        (raw) => {
          if (aborted) {
            release();
            return;
          }
          try {
            resolveAfterRelease(accept(raw));
          } catch {
            resolveAfterRelease(SDK_FAILURE);
          }
        },
        (error: unknown) => {
          if (aborted) {
            release();
            return;
          }
          try {
            resolveAfterRelease(reject(error));
          } catch {
            resolveAfterRelease(SDK_FAILURE);
          }
        },
      );

      return callerResult;
    },
  };
}
