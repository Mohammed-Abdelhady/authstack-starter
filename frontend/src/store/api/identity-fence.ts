import type { IdentityFence } from '@app/sdk';

type IdentitySnapshot =
  | { kind: 'legacy' }
  | { kind: 'inactive' }
  | { kind: 'request'; requestId: string; sessionGeneration: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function identitySnapshot(state: unknown): IdentitySnapshot {
  if (!isRecord(state) || !isRecord(state.auth)) return { kind: 'legacy' };
  const auth = state.auth;
  if (!('identityRequest' in auth) || typeof auth.sessionGeneration !== 'number') {
    return { kind: 'legacy' };
  }
  if (!isRecord(auth.identityRequest)) return { kind: 'inactive' };
  const { requestId, sessionGeneration } = auth.identityRequest;
  if (
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    typeof sessionGeneration !== 'number' ||
    sessionGeneration !== auth.sessionGeneration
  ) {
    return { kind: 'inactive' };
  }
  return { kind: 'request', requestId, sessionGeneration };
}

export function createIdentityFence(getState: () => unknown): IdentityFence<unknown> {
  return {
    snapshot: () => identitySnapshot(getState()),
    isCurrent: (started) => {
      if (!isRecord(started)) return false;
      const current = identitySnapshot(getState());
      if (started.kind === 'legacy') return current.kind === 'legacy';
      return (
        started.kind === 'request' &&
        current.kind === 'request' &&
        started.requestId === current.requestId &&
        started.sessionGeneration === current.sessionGeneration
      );
    },
  };
}
