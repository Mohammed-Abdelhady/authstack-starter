import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import type { RevocationOutcome } from '../constants/provider-tokens.constants';
import type {
  DueRevocation,
  KeptProviderToken,
  NewRevocationJob,
  ProviderRevocationJob,
  RevocationFailure,
  TokenToKeep,
} from '../types/provider-tokens';

/**
 * Provider refresh tokens, kept per identity and client id, and the jobs that
 * take them to the provider's revocation endpoint. A token lives in exactly
 * one place: kept, or inside a pending job.
 */
export abstract class ProviderTokenStore {
  /** Keeps the newest token of one identity for one client id. */
  abstract keep(token: TokenToKeep): Promise<void>;

  /** Removes and answers every token kept for the identity, any client id. */
  abstract takeTokensIn(
    unitOfWork: UnitOfWork,
    identity: { provider: string; subject: string },
  ): Promise<KeptProviderToken[]>;

  /**
   * Looks at up to `limit` kept tokens whose check is due at `now`, oldest
   * check first. One whose identity an account links has its check cleared;
   * the others are removed and answered.
   */
  abstract takeUnclaimedIn(
    unitOfWork: UnitOfWork,
    now: Date,
    limit: number,
  ): Promise<{ checked: number; unclaimed: KeptProviderToken[] }>;

  /**
   * Writes the jobs. A job with a token is pending and due at once; one
   * without is closed at once with `no_token`.
   */
  abstract addJobsIn(
    unitOfWork: UnitOfWork,
    jobs: NewRevocationJob[],
  ): Promise<void>;

  /**
   * Pending jobs that are due and not leased, oldest first, each leased until
   * `leaseUntil` so a second runner leaves it alone.
   */
  abstract claimDue(
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<DueRevocation[]>;

  /**
   * Ends a pending job: `revoked` once the provider confirmed,
   * `closed_by_staff` when a person closed it. The token is cleared. False
   * when the job was not pending.
   */
  abstract settle(
    jobId: string,
    outcome: RevocationOutcome,
    at: Date,
  ): Promise<boolean>;

  /** Counts a failed attempt, keeps its code and frees the job until its retry. */
  abstract markFailed(jobId: string, failure: RevocationFailure): Promise<void>;

  /** Flagged jobs still pending, newest flag first, for staff. */
  abstract listFlagged(limit: number): Promise<ProviderRevocationJob[]>;
}
