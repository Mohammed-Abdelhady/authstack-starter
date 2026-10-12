import { createApiClient } from '@app/sdk';
import { createBearerTransport } from './transport/bearer-transport';
import { AuthSessionError } from './errors/errors';
import { createRefreshCoordinator } from './refresh/refresh';
import { createRefreshNow } from './refresh/refresh-now';
import { createRestoreOperation } from './storage/restore';
import { AuthRuntime } from './runtime/runtime';
import { createSignInController } from './sign-in/sign-in';
import { createSignOutOperation } from './sign-out/sign-out';
import { createNativeController } from './native/native-controller';
import { validateConfiguration } from './sign-in/redirect';
import type { AuthConfiguration, AuthDependencies, AuthEngine, AuthSnapshot } from './types/auth';

export function createAuthEngine(
  configuration: AuthConfiguration,
  dependencies: AuthDependencies,
): AuthEngine {
  const validated = validateConfiguration(configuration);
  const runtime = new AuthRuntime(validated, dependencies);
  const coordinator: { current?: ReturnType<typeof createRefreshCoordinator> } = {};
  const transport = createBearerTransport(
    runtime,
    (signal) => {
      const active = coordinator.current;
      if (!active) throw new AuthSessionError();
      return active.ensureCurrentTokens(signal);
    },
    (signal) => {
      const active = coordinator.current;
      if (!active) throw new AuthSessionError();
      return active.refresh(signal);
    },
  );
  const client = createApiClient(transport);
  const revocationClient = createApiClient(runtime.rawTransport);
  const refreshCoordinator = createRefreshCoordinator(runtime, client, revocationClient);
  coordinator.current = refreshCoordinator;
  const signIn = createSignInController(runtime, client, revocationClient);
  const native = createNativeController(runtime, revocationClient, client, (options) =>
    signIn.signIn(options),
  );
  const restore = createRestoreOperation(runtime, signIn, native);
  const signOut = createSignOutOperation(runtime, revocationClient);
  try {
    runtime.unsubscribeCallbacks = dependencies.callbacks.subscribe(async (address) => {
      if (!(await native.handleAddress(address))) await signIn.handleAddress(address);
    });
  } catch {
    runtime.unsubscribeCallbacks = undefined;
  }

  const engine: AuthEngine = {
    get snapshot(): AuthSnapshot {
      return runtime.snapshot;
    },
    transport,
    subscribe: (listener) => runtime.subscribe(listener),
    restore,
    signIn: (options) =>
      native.needsCancellation()
        ? native
            .cancelNativeSignIn()
            .then((cancelled) =>
              cancelled.kind === 'cancelled'
                ? signIn.signIn(options)
                : { kind: 'signedOut' as const },
            )
        : signIn.signIn(options),
    methods: native.methods,
    nativeSignIn: native.nativeSignIn,
    cancelNativeSignIn: native.cancelNativeSignIn,
    signOut,
    refresh: createRefreshNow(runtime, refreshCoordinator),
    dispose: () => {
      runtime.dispose();
    },
  };
  return engine;
}

export { PortAbortController } from './runtime/abort-controller';
export * from './errors/errors';
export * from './types';
