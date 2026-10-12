import type { Response } from 'supertest';
import type { MailOptions } from '../../src/mail/interfaces/mail-options.interface';
import { AsyncMethodName, RaceGate, holdBefore } from './race-gate';

/**
 * For `holdBefore`: hold the call at `callIndex` of a store method on the gate
 * and let every other call through. The request is then past every earlier
 * step and has not run this one yet.
 */
export function onCall(
  gate: RaceGate,
  callIndex: number,
): (call: number) => RaceGate | undefined {
  return (call) => (call === callIndex ? gate : undefined);
}

/** Hold the call at `callIndex` of a store method on the gate. */
export function holdStoreCall<
  Store extends object,
  Name extends AsyncMethodName<Store>,
>(store: Store, method: Name, gate: RaceGate, callIndex: number): () => void {
  return holdBefore(store, method, onCall(gate, callIndex));
}

/** The 6-digit code the last captured mail carried. */
export function mailedCode(mail: MailOptions[]): string {
  const last = mail[mail.length - 1];
  const match = /\b(\d{6})\b/.exec(last?.text ?? '');
  if (!match?.[1]) {
    throw new Error('the last mail carried no 6-digit code');
  }
  return match[1];
}

/**
 * Start one request, wait for its gate, run the interference, release, and
 * return the response. The interference is where the record changes under the
 * request's feet; no timers are involved.
 */
export async function inWindow(
  install: (gate: RaceGate) => () => void,
  run: () => Promise<Response>,
  interfere: () => Promise<unknown>,
): Promise<Response> {
  const gate = new RaceGate();
  const restore = install(gate);
  try {
    const response = Promise.resolve(run());
    await gate.reached(1);
    await interfere();
    gate.release();
    return await response;
  } finally {
    restore();
  }
}
