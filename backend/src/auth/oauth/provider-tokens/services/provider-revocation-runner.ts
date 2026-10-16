import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { UnitOfWorkRunner } from '../../../../common/persistence/unit-of-work';
import { Clock } from '../../../../common/services/clock';
import { growingDelayMs } from '../../../../user/erasure/utils/erasure-failure';
import { RepeatingWork } from '../../../../user/erasure/utils/repeating-work';
import {
  REVOCATION_BATCH_SIZE,
  REVOCATION_CHECK_BATCHES_PER_RUN,
  REVOCATION_FAILURE,
  REVOCATION_FLAG_AFTER_FAILURES,
  REVOCATION_INTERVAL_MS,
  REVOCATION_LEASE_MS,
  REVOCATION_OUTCOME,
  REVOCATION_RETRY_BASE_MS,
  REVOCATION_RETRY_MAX_MS,
} from '../constants/provider-tokens.constants';
import {
  RevocableProviders,
  type RevocableProvider,
  type RevocationAttempt,
} from '../revocable-provider';
import { ProviderTokenStore } from '../stores/provider-token.store';
import type { DueRevocation } from '../types/provider-tokens';
import { ProviderRevocations } from './provider-revocations';
import { ProviderTokenCrypto } from './provider-token-crypto';

function failed(code: string): RevocationAttempt {
  return { kind: 'failed', code };
}

/**
 * Takes pending revocation jobs to their provider, outside any account
 * transaction, so a provider that is down delays a job and never an erasure
 * or an unlink. A failure waits longer each time; the fifth flags the job for
 * staff, and it keeps trying until it is settled or purged. Each run first
 * turns kept tokens that no account claimed into jobs.
 */
@Injectable()
export class ProviderRevocationRunner
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ProviderRevocationRunner.name);
  private readonly schedule: RepeatingWork;

  constructor(
    private readonly store: ProviderTokenStore,
    private readonly crypto: ProviderTokenCrypto,
    private readonly providers: RevocableProviders,
    private readonly clock: Clock,
    private readonly runner: UnitOfWorkRunner,
    private readonly revocations: ProviderRevocations,
  ) {
    this.schedule = new RepeatingWork(
      ProviderRevocationRunner.name,
      REVOCATION_INTERVAL_MS,
      () => this.runBatch(),
    );
  }

  onApplicationBootstrap(): void {
    this.schedule.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.schedule.stop();
  }

  /** One batch now, or the batch already running. Never rejects. */
  runOnce(): Promise<void> {
    return this.schedule.runOnce();
  }

  private async runBatch(): Promise<void> {
    await this.moveUnclaimed();
    const now = this.clock.now();
    const due = await this.store.claimDue(
      now,
      REVOCATION_BATCH_SIZE,
      new Date(now.getTime() + REVOCATION_LEASE_MS),
    );
    for (const job of due) {
      if (this.schedule.isStopped) return;
      await this.revoke(job);
    }
  }

  /** A failure here is logged, and the due jobs still run. */
  private async moveUnclaimed(): Promise<void> {
    try {
      for (
        let batch = 0;
        batch < REVOCATION_CHECK_BATCHES_PER_RUN;
        batch += 1
      ) {
        if (this.schedule.isStopped) return;
        const full = await this.runner.run((unitOfWork) =>
          this.revocations.enqueueUnclaimedIn(unitOfWork),
        );
        if (!full) return;
      }
    } catch (error) {
      const kind = error instanceof Error ? error.name : typeof error;
      this.logger.error(`Checking kept tokens for an account failed: ${kind}`);
    }
  }

  private async revoke(job: DueRevocation): Promise<void> {
    const attempt = await this.attempt(job);
    const now = this.clock.now();
    if (attempt.kind === 'revoked') {
      await this.store.settle(job.id, REVOCATION_OUTCOME.REVOKED, now);
      return;
    }
    const failures = job.attempts + 1;
    const delay = growingDelayMs(
      failures,
      REVOCATION_RETRY_BASE_MS,
      REVOCATION_RETRY_MAX_MS,
    );
    await this.store.markFailed(job.id, {
      code: attempt.code,
      at: now,
      nextAttemptAt: new Date(now.getTime() + delay),
      flag: failures >= REVOCATION_FLAG_AFTER_FAILURES,
    });
  }

  private async attempt(job: DueRevocation): Promise<RevocationAttempt> {
    const token = this.crypto.open(job.sealed, job);
    if (token === null) return failed(REVOCATION_FAILURE.TOKEN_UNREADABLE);
    const provider = this.providerOf(job.provider);
    if (!provider) return failed(REVOCATION_FAILURE.PROVIDER_UNAVAILABLE);
    try {
      return await provider.revokeProviderToken({
        token,
        clientId: job.clientId,
      });
    } catch {
      return failed(REVOCATION_FAILURE.REQUEST_FAILED);
    }
  }

  /** Undefined when no enabled strategy revokes it, or the registry is absent. */
  private providerOf(providerId: string): RevocableProvider | undefined {
    try {
      return this.providers.find(providerId);
    } catch {
      return undefined;
    }
  }
}
