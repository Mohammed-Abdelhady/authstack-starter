import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import {
  REVOCATION_OUTCOME,
  REVOCATION_STATE,
  type RevocationOutcome,
} from '../constants/provider-tokens.constants';
import { ProviderTokenStore } from '../stores/provider-token.store';
import type {
  DueRevocation,
  KeptProviderToken,
  NewRevocationJob,
  ProviderRevocationJob,
  RevocationFailure,
  SealedToken,
  TokenToKeep,
} from '../types/provider-tokens';

/** A cleared check, which no `now` reaches. */
const NEVER = new Date(8_640_000_000_000_000);

export interface MemoryRevocation extends ProviderRevocationJob {
  subject: string;
  clientId: string | null;
  sealed: SealedToken | null;
  leaseUntil: Date | null;
}

/** The token store's rules in memory: one token per owner, one place per token. */
export class MemoryProviderTokenStore extends ProviderTokenStore {
  readonly tokens: TokenToKeep[] = [];
  readonly jobs: MemoryRevocation[] = [];
  /** Identities some account links, as `provider:subject`. */
  readonly linked = new Set<string>();

  keep(token: TokenToKeep): Promise<void> {
    const index = this.tokens.findIndex(
      (kept) =>
        kept.provider === token.provider &&
        kept.subject === token.subject &&
        kept.clientId === token.clientId,
    );
    if (index === -1) this.tokens.push(token);
    else this.tokens[index] = token;
    return Promise.resolve();
  }

  takeTokensIn(
    _unitOfWork: UnitOfWork,
    identity: { provider: string; subject: string },
  ): Promise<KeptProviderToken[]> {
    const taken = this.tokens.filter(
      (kept) =>
        kept.provider === identity.provider &&
        kept.subject === identity.subject,
    );
    for (const token of taken)
      this.tokens.splice(this.tokens.indexOf(token), 1);
    return Promise.resolve(taken);
  }

  takeUnclaimedIn(_unitOfWork: UnitOfWork, now: Date, limit: number) {
    const due = this.tokens
      .filter((kept) => kept.checkAfter <= now)
      .sort((a, b) => a.checkAfter.getTime() - b.checkAfter.getTime())
      .slice(0, limit);
    const unclaimed: KeptProviderToken[] = [];
    for (const token of due) {
      const index = this.tokens.indexOf(token);
      if (this.linked.has(`${token.provider}:${token.subject}`)) {
        this.tokens[index] = { ...token, checkAfter: NEVER };
        continue;
      }
      this.tokens.splice(index, 1);
      const { checkAfter: _checkAfter, ...kept } = token;
      unclaimed.push(kept);
    }
    return Promise.resolve({ checked: due.length, unclaimed });
  }

  addJobsIn(_unitOfWork: UnitOfWork, jobs: NewRevocationJob[]): Promise<void> {
    for (const job of jobs) {
      const pending = job.sealed !== undefined;
      this.jobs.push({
        id: `revocation-${this.jobs.length + 1}`,
        provider: job.provider,
        subject: job.subject,
        clientId: job.clientId,
        userId: job.userId,
        reason: job.reason,
        state: pending ? REVOCATION_STATE.PENDING : REVOCATION_STATE.CLOSED,
        outcome: pending ? null : REVOCATION_OUTCOME.NO_TOKEN,
        sealed: job.sealed ?? null,
        attempts: 0,
        failureCode: null,
        flaggedAt: null,
        nextAttemptAt: pending ? job.createdAt : null,
        leaseUntil: null,
        createdAt: job.createdAt,
        settledAt: pending ? null : job.createdAt,
      });
    }
    return Promise.resolve();
  }

  claimDue(
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<DueRevocation[]> {
    const due = this.jobs.filter(
      (job) =>
        job.state === REVOCATION_STATE.PENDING &&
        (job.nextAttemptAt === null || job.nextAttemptAt <= now) &&
        (job.leaseUntil === null || job.leaseUntil <= now),
    );
    return Promise.resolve(
      due.slice(0, limit).flatMap((job) => {
        if (!job.sealed || !job.clientId) return [];
        job.leaseUntil = leaseUntil;
        return [
          {
            id: job.id,
            provider: job.provider,
            subject: job.subject,
            clientId: job.clientId,
            sealed: job.sealed,
            attempts: job.attempts,
          },
        ];
      }),
    );
  }

  settle(
    jobId: string,
    outcome: RevocationOutcome,
    at: Date,
  ): Promise<boolean> {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (job?.state !== REVOCATION_STATE.PENDING) return Promise.resolve(false);
    job.state =
      outcome === REVOCATION_OUTCOME.REVOKED
        ? REVOCATION_STATE.REVOKED
        : REVOCATION_STATE.CLOSED;
    job.outcome = outcome;
    job.settledAt = at;
    job.sealed = null;
    job.leaseUntil = null;
    return Promise.resolve(true);
  }

  markFailed(jobId: string, failure: RevocationFailure): Promise<void> {
    const job = this.jobs.find((candidate) => candidate.id === jobId);
    if (job?.state === REVOCATION_STATE.PENDING) {
      job.attempts += 1;
      job.failureCode = failure.code;
      job.nextAttemptAt = failure.nextAttemptAt;
      job.leaseUntil = null;
      if (failure.flag) job.flaggedAt ??= failure.at;
    }
    return Promise.resolve();
  }

  listFlagged(limit: number): Promise<ProviderRevocationJob[]> {
    return Promise.resolve(
      this.jobs
        .filter(
          (job) =>
            job.state === REVOCATION_STATE.PENDING && job.flaggedAt !== null,
        )
        .slice(0, limit),
    );
  }
}
