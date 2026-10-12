import { MailCounterPurpose } from '../constants/registration';

/** Shared names of the unique rules a mail counter can run into. */
export const MAIL_COUNTER_CONSTRAINT = {
  ADDRESS_PURPOSE: 'mail_counter.email_purpose',
} as const;

export const MAIL_RECORD = {
  RECORDED: 'recorded',
  NOT_RECORDED: 'not_recorded',
} as const;

export type MailRecord = (typeof MAIL_RECORD)[keyof typeof MAIL_RECORD];

export interface MailCounterKey {
  email: string;
  purpose: MailCounterPurpose;
}

/** The cap one mail is counted against. */
export interface MailWindowRule {
  now: Date;
  windowMs: number;
  limit: number;
}

/**
 * What the per-address mail cap needs stored. Each method is one statement that
 * commits by itself: the cap is not part of any atomic workflow.
 *
 * A window is judged by when it started, never by whether its row is still
 * there. `expiresAt` only says how long the row is kept, so a counter that
 * cleanup has not removed yet and one that it has removed count the same.
 */
export abstract class MailCounterStore {
  /**
   * Counts one mail on the stored counter when it has room. A counter whose
   * window started `windowMs` or longer ago starts a new window at one.
   * `not_recorded` covers both no counter and a full one.
   */
  abstract recordWithinCap(
    key: MailCounterKey,
    rule: MailWindowRule,
  ): Promise<MailRecord>;

  /** True when a counter is stored, whatever its window or count. */
  abstract hasCounter(key: MailCounterKey): Promise<boolean>;

  /**
   * Stores a counter at one mail in a window starting `now`. A counter another
   * request stored first is a `UniqueConflictError` named
   * `MAIL_COUNTER_CONSTRAINT.ADDRESS_PURPOSE`.
   */
  abstract openCounter(
    key: MailCounterKey,
    window: { now: Date; windowMs: number },
  ): Promise<void>;

  /** Removes counters whose retention ended at or before `cutoff`. */
  abstract deleteExpiredBefore(cutoff: Date): Promise<number>;
}
