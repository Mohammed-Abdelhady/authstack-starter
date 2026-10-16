import type {
  IDEMPOTENCY_CLAIM,
  STAFF_OPERATION,
} from '../constants/staff-operations';

export type StaffOperation =
  (typeof STAFF_OPERATION)[keyof typeof STAFF_OPERATION];

/** A key belongs to one actor, one application and one operation. */
export interface IdempotencyScope {
  readonly actorId: string;
  readonly clientId: string;
  readonly operation: StaffOperation;
  readonly key: string;
}

export interface IdempotencyClaimInput {
  readonly scope: IdempotencyScope;
  /** SHA-256 of the operation and the request body, so a changed body is told apart. */
  readonly requestHash: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

export type IdempotencyClaim =
  | { readonly status: typeof IDEMPOTENCY_CLAIM.CLAIMED }
  | {
      readonly status: typeof IDEMPOTENCY_CLAIM.EXISTING;
      readonly requestHash: string;
      /** What the first create made. Null only while that create has not committed. */
      readonly resourceId: string | null;
    };
