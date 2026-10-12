import type {
  AbortSignalPort,
  AuthSnapshot,
  RestoreOutcome,
  SignInOutcome,
  SignOutOutcome,
} from '@app/native-auth';
import type { Transport } from '@app/sdk';
import type { EnginePort } from '../../src/types';

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export const SIGNED_OUT: AuthSnapshot = { status: 'signedOut', operation: 'none' };

export function signedInAs(id: string): AuthSnapshot {
  return {
    status: 'signedIn',
    operation: 'none',
    profile: {
      id,
      email: `${id}@example.test`,
      name: id,
      role: 'user',
      permissions: [],
      authProvider: 'email',
      isVerified: true,
      twoFactorEnabled: false, // feature:totp
      passkeyCount: 0, // feature:passkeys
      linkedProviders: [],
    },
  };
}

export interface FakeEngine {
  engine: EnginePort;
  /** Publishes a snapshot to every subscriber, as the engine does on a state change. */
  publish(snapshot: AuthSnapshot): void;
  signIns: Deferred<SignInOutcome>[];
  signOuts: number;
  /** The next sign-out waits for the test, and ends the session only when it is answered. */
  holdSignOut(): Deferred<SignOutOutcome>;
  /** The next sign-out rejects with this and leaves the session as it was. */
  failSignOut(error: unknown): void;
  restores: number;
}

/** Stands in for the engine: the screens own none of it. */
export function createFakeEngine(
  transport: Transport<AbortSignalPort>,
  initial: AuthSnapshot = SIGNED_OUT,
): FakeEngine {
  let snapshot = initial;
  const listeners = new Set<(snapshot: AuthSnapshot) => void>();
  const heldSignOuts: Deferred<SignOutOutcome>[] = [];
  const signOutFailures: { error: unknown }[] = [];
  const fake: FakeEngine = {
    signIns: [],
    signOuts: 0,
    holdSignOut() {
      const held = deferred<SignOutOutcome>();
      heldSignOuts.push(held);
      return held;
    },
    failSignOut(error) {
      signOutFailures.push({ error });
    },
    restores: 0,
    publish(next) {
      snapshot = next;
      for (const listener of [...listeners]) listener(next);
    },
    engine: {
      get snapshot() {
        return snapshot;
      },
      transport,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      signIn() {
        const pending = deferred<SignInOutcome>();
        fake.signIns.push(pending);
        return pending.promise;
      },
      signOut(): Promise<SignOutOutcome> {
        fake.signOuts += 1;
        const failure = signOutFailures.shift();
        if (failure !== undefined) return Promise.reject(failure.error);
        const held = heldSignOuts.shift();
        if (held !== undefined) {
          return held.promise.then((outcome) => {
            fake.publish(SIGNED_OUT);
            return outcome;
          });
        }
        fake.publish({ status: 'signedOut', operation: 'signingOut' });
        return Promise.resolve({ kind: 'signedOut', revocation: 'revoked' });
      },
      restore(): Promise<RestoreOutcome> {
        fake.restores += 1;
        return Promise.resolve({ kind: 'restored', status: snapshot.status });
      },
    },
  };
  return fake;
}
