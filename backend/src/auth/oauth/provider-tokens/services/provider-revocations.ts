import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { Clock } from '../../../../common/services/clock';
import { MS_PER_DAY } from '../../../../user/erasure/constants/erasure.constants';
import {
  REVOCABLE_PROVIDERS,
  REVOCATION_CHECK_BATCH_SIZE,
  REVOCATION_KEEP_DAYS,
  REVOCATION_REASON,
} from '../constants/provider-tokens.constants';
import { ProviderTokenStore } from '../stores/provider-token.store';
import type {
  NewRevocationJob,
  RevocationRequest,
} from '../types/provider-tokens';

/**
 * Writes revocation jobs in the unit of work that erases an account or
 * unlinks a provider, so the jobs commit with that change or not at all.
 */
@Injectable()
export class ProviderRevocations {
  constructor(
    private readonly store: ProviderTokenStore,
    private readonly clock: Clock,
  ) {}

  /**
   * One pending job per kept token of each identity whose provider revokes,
   * moving the token into it. An identity with no kept token gets a job that
   * is closed at once with `no_token`, so the record says why nothing ran.
   */
  async enqueueIn(
    unitOfWork: UnitOfWork,
    request: RevocationRequest,
  ): Promise<void> {
    const times = this.jobTimes();
    const jobs: NewRevocationJob[] = [];
    for (const identity of request.identities) {
      if (!REVOCABLE_PROVIDERS.includes(identity.provider)) continue;
      const tokens = await this.store.takeTokensIn(unitOfWork, {
        provider: identity.provider,
        subject: identity.providerId,
      });
      const job = {
        provider: identity.provider,
        subject: identity.providerId,
        userId: request.userId,
        reason: request.reason,
        ...times,
      };
      if (tokens.length === 0) jobs.push({ ...job, clientId: null });
      for (const token of tokens) {
        jobs.push({ ...job, clientId: token.clientId, sealed: token.sealed });
      }
    }
    if (jobs.length > 0) await this.store.addJobsIn(unitOfWork, jobs);
  }

  /**
   * Checks one batch of kept tokens whose check is due. A token whose
   * identity no account links, after a refused sign-up or a sign-in that
   * raced an erasure, moves into a pending job. Answers whether the batch
   * was full, so a caller knows to run another.
   */
  async enqueueUnclaimedIn(unitOfWork: UnitOfWork): Promise<boolean> {
    const times = this.jobTimes();
    const { checked, unclaimed } = await this.store.takeUnclaimedIn(
      unitOfWork,
      times.createdAt,
      REVOCATION_CHECK_BATCH_SIZE,
    );
    const jobs = unclaimed.map((token): NewRevocationJob => ({
      provider: token.provider,
      subject: token.subject,
      clientId: token.clientId,
      userId: null,
      reason: REVOCATION_REASON.UNCLAIMED,
      sealed: token.sealed,
      ...times,
    }));
    if (jobs.length > 0) await this.store.addJobsIn(unitOfWork, jobs);
    return checked === REVOCATION_CHECK_BATCH_SIZE;
  }

  private jobTimes(): { createdAt: Date; purgeAfter: Date } {
    const createdAt = this.clock.now();
    return {
      createdAt,
      purgeAfter: new Date(
        createdAt.getTime() + REVOCATION_KEEP_DAYS * MS_PER_DAY,
      ),
    };
  }
}
