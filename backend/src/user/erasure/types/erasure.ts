import type { ErasureStep } from '../constants/erasure.constants';

export interface ErasureJob {
  id: string;
  userId: string;
  step: ErasureStep;
  attempts: number;
  failureCode: string | null;
  failedAt: Date | null;
  nextAttemptAt: Date | null;
  startedAt: Date;
  erasedAt: Date | null;
}

/** Who holds a job and until when. Another worker takes it only after `until`. */
export interface ErasureLease {
  owner: string;
  now: Date;
  until: Date;
}

/** What the host hook is told about the account whose data it removes. */
export interface ErasureSubject {
  accountId: string;
  /** The current address, then the pending one while the account holds its claim. */
  addresses: string[];
}

/**
 * The addresses on the account row. A pending one stays there after its claim
 * lapses, when another account may have taken it.
 */
export interface AccountAddresses {
  address: string | null;
  pendingAddress: string | null;
}

export interface BegunErasure {
  job: ErasureJob;
  accountId: string;
  onAccount: AccountAddresses;
}

/** Which deactivated accounts the schedule command dates, and to when. */
export interface UnscheduledSelection {
  eraseAfter: Date;
  /**
   * Also accounts deactivated before this time with no mark of an own
   * deletion, from before the mark was written. Staff deactivations of that
   * time are among them: nothing tells the two apart.
   */
  deletedBefore?: Date;
}

export interface ErasureFailure {
  code: string;
  at: Date;
  nextAttemptAt: Date;
}

export interface LinkedIdentity {
  provider: string;
  providerId: string;
}

/**
 * Read before anything is deleted, so no row left behind can match a later
 * account with the same address.
 */
export interface AccountErasureRead {
  accountId: string;
  onAccount: AccountAddresses;
  sessionIds: string[];
  identities: LinkedIdentity[];
}

/** What the removal goes by: only the addresses the account still holds. */
export interface ErasureFacts extends Omit<AccountErasureRead, 'onAccount'> {
  addresses: string[];
}
