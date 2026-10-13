import { TransportError, TRANSPORT_FAILURE } from '@app/sdk';
import type { ApiClient, NativeMethods } from '@app/sdk';
import { AuthDisposedError } from '../errors/errors';
import { PortAbortController } from '../runtime/abort-controller';
import { withPortDeadline } from '../runtime/deadlines';
import type { AuthRuntime } from '../runtime/runtime';
import type { AbortSignalPort, Unsubscribe } from '../types/auth';

interface MethodsLease {
  result: Promise<NativeMethods>;
  cancel: (error: unknown) => void;
  listeners: Map<AbortSignalPort, Unsubscribe>;
  settled: boolean;
}

export function createNativeMethodsReader(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  deadlineMs: number,
): (signal?: AbortSignalPort) => Promise<NativeMethods> {
  let active: MethodsLease | undefined;

  const start = (): MethodsLease => {
    const controller = new PortAbortController();
    let rejectCancellation: (error: unknown) => void = () => undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const cancel = (error: unknown): void => {
      rejectCancellation(error);
      controller.abort();
    };
    const physical = Promise.resolve().then(() =>
      readAvailableMethods(runtime, client, controller.signal),
    );
    let cancelDeadline: Unsubscribe = () => undefined;
    const unsubscribeDispose = runtime.onDispose(() => cancel(new AuthDisposedError()));
    const bounded = withPortDeadline(
      {
        after: (milliseconds, callback) => {
          cancelDeadline = runtime.dependencies.timer.after(milliseconds, callback);
          return cancelDeadline;
        },
      },
      deadlineMs,
      () => physical,
      'native.methods',
      () => controller.abort(),
    );
    const result = Promise.race([bounded, cancelled]).finally(() => {
      try {
        cancelDeadline();
      } catch {
        // Caller settlement still clears lifecycle listeners when the timer port fails.
      }
      lease.settled = true;
      for (const unsubscribe of lease.listeners.values()) unsubscribe();
      lease.listeners.clear();
      unsubscribeDispose();
      controller.abort();
    });
    const lease: MethodsLease = { result, cancel, listeners: new Map(), settled: false };
    const release = (): void => {
      if (active === lease) active = undefined;
    };
    // Caller settlement never releases transport or SDK work that still owns the lease.
    void physical.then(release, release);
    return lease;
  };

  return (signal) => {
    if (runtime.disposed) return Promise.reject(new AuthDisposedError());
    if (signal?.aborted) return Promise.reject(aborted());
    const lease = active ?? (active = start());
    if (signal && !lease.settled && !lease.listeners.has(signal)) {
      const onAbort = (): void => lease.cancel(aborted());
      signal.addEventListener('abort', onAbort);
      lease.listeners.set(signal, () => signal.removeEventListener('abort', onAbort));
      if (signal.aborted) onAbort();
    }
    return lease.result;
  };
}

async function readAvailableMethods(
  runtime: AuthRuntime,
  client: ApiClient<AbortSignalPort>,
  signal: AbortSignalPort,
): Promise<NativeMethods> {
  assertActive(runtime, signal);
  const server = await client.nativeAuth.methods(runtime.config.clientId, { signal });
  assertActive(runtime, signal);
  const passkeys = runtime.dependencies.passkeys;
  const providers = runtime.dependencies.providerSignIn;
  const availablePasskeys = passkeys && (await safeAvailable(() => passkeys.available()));
  assertActive(runtime, signal);
  const availableProviders = await Promise.all(
    server.providers.map(async (method) => {
      if (signal.aborted || runtime.disposed) return method;
      if (method.mode === 'system') return method;
      if (!providers || !(await safeAvailable(() => providers.available(method))))
        return { id: method.id, displayName: method.displayName, mode: 'system' as const };
      return method;
    }),
  );
  assertActive(runtime, signal);
  return {
    ...server,
    capabilities: {
      ...server.capabilities,
      passkeys: server.capabilities.passkeys && Boolean(availablePasskeys),
    },
    providers: availableProviders,
  };
}

function assertActive(runtime: AuthRuntime, signal: AbortSignalPort): void {
  if (runtime.disposed) throw new AuthDisposedError();
  if (signal.aborted) throw aborted();
}

function aborted(): TransportError {
  return new TransportError(TRANSPORT_FAILURE.ABORTED);
}

async function safeAvailable(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}
