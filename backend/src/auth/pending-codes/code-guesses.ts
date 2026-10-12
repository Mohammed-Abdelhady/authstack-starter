import { MailCounterPurpose } from '../constants/registration';

export interface CodeGuessKey {
  email: string;
  purpose: MailCounterPurpose;
}

/** The lock one address and purpose is counted against. */
export interface CodeGuessRule {
  /** The guess that reaches this count is the last before a lock. */
  limit: number;
  lockBaseMs: number;
  lockMaxMs: number;
  maxLockLevel: number;
  memoryMs: number;
}

/**
 * What is stored about the guesses at one address and purpose. It is judged by
 * `stateExpiresAt`, never by whether its row is still there: past that moment
 * it reads as no guesses and no earlier lock.
 */
export interface CodeGuessState {
  failedGuesses: number;
  lockLevel: number;
  lockedUntil: Date | null;
  stateExpiresAt: Date | null;
}

/** True while no code for the address and purpose is accepted. */
export function isGuessLocked(
  state: Pick<CodeGuessState, 'lockedUntil' | 'stateExpiresAt'> | null,
  now: Date,
): boolean {
  if (!state?.stateExpiresAt || !state.lockedUntil) {
    return false;
  }
  return state.stateExpiresAt > now && state.lockedUntil > now;
}

/** The state the first counted guess at an address leaves behind. */
export function firstGuessState(
  now: Date,
  rule: CodeGuessRule,
): CodeGuessState {
  const locks = rule.limit <= 1;
  const lockedUntil = locks
    ? new Date(now.getTime() + Math.min(rule.lockBaseMs, rule.lockMaxMs))
    : null;
  return {
    failedGuesses: locks ? 0 : 1,
    lockLevel: locks ? Math.min(1, rule.maxLockLevel) : 0,
    lockedUntil,
    stateExpiresAt: new Date((lockedUntil ?? now).getTime() + rule.memoryMs),
  };
}
