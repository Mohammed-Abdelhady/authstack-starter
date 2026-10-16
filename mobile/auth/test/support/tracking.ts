import { afterEach, expect } from 'vitest';
import type { AuthEngine, TimerPort } from '../../src';
import type { TransportRequest } from '@app/sdk';

export interface ScriptedRequestLog {
  sent: Pick<TransportRequest, 'path' | 'body'>[];
}

interface Scenario {
  engine: AuthEngine;
  timer: TimerPort & { pending: number };
  pending: Set<number>;
}

const transports = new Set<ScriptedRequestLog>();
const allowedRefreshReplays = new Map<string, number>();
const scenarios = new Set<Scenario>();
let nextPendingId = 0;

export function registerTransport(transport: ScriptedRequestLog): void {
  transports.add(transport);
}

export function trackEngine(
  engine: AuthEngine,
  timer: TimerPort & { pending: number },
): AuthEngine {
  const scenario: Scenario = { engine, timer, pending: new Set() };
  scenarios.add(scenario);
  const track = <T>(promise: Promise<T>): Promise<T> => {
    const id = nextPendingId;
    nextPendingId += 1;
    scenario.pending.add(id);
    void promise.then(
      (value) => {
        scenario.pending.delete(id);
        return value;
      },
      () => {
        scenario.pending.delete(id);
      },
    );
    return promise;
  };
  const transport = {
    request: (request: Parameters<AuthEngine['transport']['request']>[0]) =>
      track(engine.transport.request(request)),
  };
  return {
    get snapshot() {
      return engine.snapshot;
    },
    get transport() {
      return transport;
    },
    subscribe: (listener) => engine.subscribe(listener),
    restore: () => track(engine.restore()),
    signIn: (options) => track(engine.signIn(options)),
    methods: () => track(engine.methods()),
    nativeSignIn: (action) => track(engine.nativeSignIn(action)),
    cancelNativeSignIn: () => track(engine.cancelNativeSignIn()),
    signOut: () => track(engine.signOut()),
    refresh: () => track(engine.refresh()),
    passkeys: {
      available: () => track(engine.passkeys.available()),
      register: (name) => track(engine.passkeys.register(name)),
      list: () => track(engine.passkeys.list()),
      rename: (passkeyId, name) => track(engine.passkeys.rename(passkeyId, name)),
      remove: (passkeyId) => track(engine.passkeys.remove(passkeyId)),
    },
    dispose: () => engine.dispose(),
  };
}

export function allowRefreshReplayAfterThrottle(token: string): void {
  allowedRefreshReplays.set(token, (allowedRefreshReplays.get(token) ?? 0) + 1);
}

export function allowRefreshReplayAfterSharedStoreRace(token: string): void {
  allowRefreshReplayAfterThrottle(token);
}

export function allowRefreshReplayAfterNonRotatingFailure(token: string): void {
  allowRefreshReplayAfterThrottle(token);
}

export function allowRefreshReplayAfterDpopNonce(token: string): void {
  allowRefreshReplayAfterThrottle(token);
}

export function allowBoundRefreshReplayAfterUnknownOutcome(token: string): void {
  allowRefreshReplayAfterThrottle(token);
}

export function assertNoRefreshTokenReplay(): void {
  const tokens = [...transports].flatMap((transport) =>
    transport.sent.flatMap((request) => {
      if (request.path !== '/api/oauth/token' || !isRefreshRequest(request.body)) return [];
      return [request.body.refresh_token];
    }),
  );
  const repeats = new Map<string, number>();
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) repeats.set(token, (repeats.get(token) ?? 0) + 1);
    else seen.add(token);
  }
  expect(repeats).toEqual(allowedRefreshReplays);
}

export function revokedTokens(transport: ScriptedRequestLog): string[] {
  return transport.sent.flatMap(({ path, body }) => {
    if (
      path !== '/api/oauth/revoke' ||
      typeof body !== 'object' ||
      body === null ||
      !('token' in body) ||
      typeof body.token !== 'string'
    )
      return [];
    return [body.token];
  });
}

function isRefreshRequest(value: unknown): value is { grant_type: string; refresh_token: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'grant_type' in value &&
    value.grant_type === 'refresh_token' &&
    'refresh_token' in value &&
    typeof value.refresh_token === 'string'
  );
}

afterEach(() => {
  const failures: string[] = [];
  try {
    try {
      assertNoRefreshTokenReplay();
    } catch (error) {
      failures.push(String(error));
    }
    for (const scenario of scenarios) {
      for (const [label, actual] of [
        ['pending engine promises', scenario.pending.size],
        ['operation', scenario.engine.snapshot.operation],
        ['pending timers', scenario.timer.pending],
      ] as const) {
        const expected = label === 'operation' ? 'none' : 0;
        if (actual !== expected)
          failures.push(`${label}: expected ${expected}, received ${actual}`);
      }
    }
    expect(failures).toEqual([]);
  } finally {
    transports.clear();
    allowedRefreshReplays.clear();
    scenarios.clear();
  }
});
