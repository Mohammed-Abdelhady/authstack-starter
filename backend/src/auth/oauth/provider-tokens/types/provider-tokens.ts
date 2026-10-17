import type { LinkedIdentity } from '../../../../user/erasure/types/erasure';
import type {
  RevocationOutcome,
  RevocationReason,
  RevocationState,
} from '../constants/provider-tokens.constants';

/** AES-256-GCM output, with the id of the key that wrote it. */
export interface SealedToken {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
}

/** Who a token speaks for. Bound into the ciphertext, so a row cannot be moved. */
export interface TokenOwner {
  provider: string;
  subject: string;
  clientId: string;
}

export interface KeptProviderToken extends TokenOwner {
  sealed: SealedToken;
  storedAt: Date;
}

export interface TokenToKeep extends KeptProviderToken {
  /** When to check that an account links the identity; see `takeUnclaimedIn`. */
  checkAfter: Date;
}

export interface RevocationRequest {
  userId: string;
  identities: LinkedIdentity[];
  reason: RevocationReason;
}

export interface NewRevocationJob {
  provider: string;
  subject: string;
  clientId: string | null;
  /** Null for a token no account claimed. */
  userId: string | null;
  reason: RevocationReason;
  /** Absent for a job that closes at once because no token was kept. */
  sealed?: SealedToken;
  createdAt: Date;
  purgeAfter: Date;
}

export interface DueRevocation extends TokenOwner {
  id: string;
  sealed: SealedToken;
  attempts: number;
}

export interface RevocationFailure {
  code: string;
  at: Date;
  nextAttemptAt: Date;
  /** Set on the failure that reaches the flag threshold. */
  flag: boolean;
}

export interface ProviderRevocationJob {
  id: string;
  provider: string;
  userId: string | null;
  reason: RevocationReason;
  state: RevocationState;
  outcome: RevocationOutcome | null;
  attempts: number;
  failureCode: string | null;
  flaggedAt: Date | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  settledAt: Date | null;
}
