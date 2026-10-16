import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Clock } from '../../../common/services/clock';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
// feature:oauth-core:start
import { REVOCATION_REASON } from '../../../auth/oauth/provider-tokens/constants/provider-tokens.constants';
import { ProviderRevocations } from '../../../auth/oauth/provider-tokens/services/provider-revocations';
// feature:oauth-core:end
import { AccountErasureHook } from '../account-erasure-hook';
import {
  ERASURE_BATCH_SIZE,
  ERASURE_FAILURE,
  ERASURE_INTERVAL_MS,
  ERASURE_JOB_KEEP_DAYS,
  ERASURE_LEASE_MS,
  ERASURE_STEP,
  MS_PER_DAY,
} from '../constants/erasure.constants';
import { AccountEraser } from '../stores/account-eraser';
import { ErasureJobStore } from '../stores/erasure-job.store';
import type {
  AccountAddresses,
  ErasureJob,
  ErasureLease,
  ErasureSubject,
} from '../types/erasure';
import { erasureFailure, hookFailureCode } from '../utils/erasure-failure';
import { RepeatingWork } from '../utils/repeating-work';
import { ErasureSettings } from './erasure-settings';

/** A hook failure inside step 3, kept apart from a failure of the removal. */
class HookFailedInTransaction extends Error {
  constructor(readonly code: string) {
    super('The account erasure hook failed');
  }
}

/** A job this worker leased, with what the hook is told. */
interface StartedErasure {
  job: ErasureJob;
  subject: ErasureSubject;
}

/**
 * Erases deactivated accounts once their grace period has passed, in three
 * steps the job row records: mark the account as being erased, call the host
 * hook, then remove the account and everything that points at it in one
 * transaction. Does nothing while erasure is off.
 */
@Injectable()
export class ErasureWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ErasureWorker.name);
  private readonly owner = randomUUID();
  private readonly schedule: RepeatingWork;

  constructor(
    private readonly jobs: ErasureJobStore,
    private readonly eraser: AccountEraser,
    private readonly hook: AccountErasureHook,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly settings: ErasureSettings,
    private readonly ledger: AddressLedger,
    private readonly revocations: ProviderRevocations, // feature:oauth-core
  ) {
    this.schedule = new RepeatingWork(
      ErasureWorker.name,
      ERASURE_INTERVAL_MS,
      () => this.runBatch(),
    );
  }

  onApplicationBootstrap(): void {
    if (this.settings.enabled()) this.schedule.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.schedule.stop();
  }

  /** One batch now, or the batch already running. Never rejects. */
  runOnce(): Promise<void> {
    return this.schedule.runOnce();
  }

  private async runBatch(): Promise<void> {
    if (!this.settings.enabled()) return;
    const due = await this.jobs.findDue(this.clock.now(), ERASURE_BATCH_SIZE);
    for (const userId of due) {
      // Between accounts only: each step is whole, so a stop never splits one.
      if (this.schedule.isStopped) return;
      await this.eraseAccount(userId);
    }
  }

  private async eraseAccount(userId: string): Promise<void> {
    const lease = this.lease();
    let begun: StartedErasure | null;
    try {
      begun = await this.runner.run((unitOfWork) =>
        this.beginIn(unitOfWork, userId, lease),
      );
    } catch (error) {
      this.logFailure('step 1', undefined, error);
      return;
    }
    if (!begun) return;
    if (
      begun.job.step === ERASURE_STEP.ERASING &&
      !this.hook.runsInEraseTransaction &&
      !(await this.callHook(begun, lease))
    ) {
      return;
    }
    await this.remove(begun, lease);
  }

  private async beginIn(
    unitOfWork: UnitOfWork,
    userId: string,
    lease: ErasureLease,
  ): Promise<StartedErasure | null> {
    const begun = await this.jobs.beginIn(unitOfWork, userId, lease);
    if (!begun) return null;
    const addresses = await this.ownAddresses(
      unitOfWork,
      begun.accountId,
      begun.onAccount,
    );
    return {
      job: begun.job,
      subject: { accountId: begun.accountId, addresses },
    };
  }

  /**
   * The account's address, and its pending one while it still holds the claim
   * on it. A lapsed claim leaves that address free for another account, whose
   * rows it would match.
   */
  private async ownAddresses(
    unitOfWork: UnitOfWork,
    accountId: string,
    onAccount: AccountAddresses,
  ): Promise<string[]> {
    const own = onAccount.address ? [onAccount.address] : [];
    const pending = onAccount.pendingAddress;
    if (
      pending &&
      (await this.ledger.holdsLiveClaim(unitOfWork, {
        address: pending,
        owner: accountId,
        now: this.clock.now(),
      }))
    ) {
      own.push(pending);
    }
    return own;
  }

  private async callHook(
    begun: StartedErasure,
    lease: ErasureLease,
  ): Promise<boolean> {
    try {
      await this.hook.erase(begun.subject);
    } catch (error) {
      await this.fail(begun, lease, hookFailureCode(error));
      return false;
    }
    return this.jobs.markHookDone(begun.job.id, lease);
  }

  private async remove(
    begun: StartedErasure,
    lease: ErasureLease,
  ): Promise<void> {
    try {
      const erased = await this.runner.run((unitOfWork) =>
        this.removeIn(unitOfWork, begun),
      );
      if (!erased) {
        this.logger.warn(
          `Erasure job ${begun.job.id} withdrawn: its account is no longer due`,
        );
      }
    } catch (error) {
      const code =
        error instanceof HookFailedInTransaction
          ? error.code
          : ERASURE_FAILURE.ERASE_FAILED;
      this.logFailure('step 3', begun.job.id, error);
      await this.fail(begun, lease, code);
    }
  }

  /**
   * False when the account is gone or no longer due, as when it was restored
   * after step 1: nothing is removed and the job is withdrawn.
   */
  private async removeIn(
    unitOfWork: UnitOfWork,
    begun: StartedErasure,
  ): Promise<boolean> {
    const now = this.clock.now();
    const read = await this.eraser.readFactsIn(
      unitOfWork,
      begun.job.userId,
      now,
    );
    if (!read) {
      await this.jobs.withdrawIn(unitOfWork, begun.job.id);
      return false;
    }
    const { onAccount, ...rest } = read;
    const facts = {
      ...rest,
      addresses: await this.ownAddresses(unitOfWork, read.accountId, onAccount),
    };
    if (this.hook.runsInEraseTransaction) {
      await this.hook
        .erase(begun.subject, unitOfWork)
        .catch((error: unknown) => {
          throw new HookFailedInTransaction(hookFailureCode(error));
        });
    }
    // feature:oauth-core:start
    await this.revocations.enqueueIn(unitOfWork, {
      userId: facts.accountId,
      identities: facts.identities,
      reason: REVOCATION_REASON.ERASURE,
    });
    // feature:oauth-core:end
    await this.eraser.eraseIn(unitOfWork, facts);
    const purgeAfter = new Date(
      now.getTime() + ERASURE_JOB_KEEP_DAYS * MS_PER_DAY,
    );
    await this.jobs.finishIn(unitOfWork, begun.job.id, now, purgeAfter);
    return true;
  }

  private async fail(
    begun: StartedErasure,
    lease: ErasureLease,
    code: string,
  ): Promise<void> {
    const failure = erasureFailure(
      code,
      begun.job.attempts + 1,
      this.clock.now(),
    );
    try {
      await this.jobs.markFailed(begun.job.id, lease.owner, failure);
    } catch (error) {
      this.logFailure('recording a failure', begun.job.id, error);
    }
    this.logger.warn(`Erasure job ${begun.job.id} failed with ${code}`);
  }

  private lease(): ErasureLease {
    const now = this.clock.now();
    return {
      owner: this.owner,
      now,
      until: new Date(now.getTime() + ERASURE_LEASE_MS),
    };
  }

  /** Names the error's class only: its message could hold what a hook was given. */
  private logFailure(stage: string, jobId: string | undefined, error: unknown) {
    const kind = error instanceof Error ? error.name : typeof error;
    this.logger.error(
      `Erasure ${stage} failed${jobId ? ` for job ${jobId}` : ''}: ${kind}`,
    );
  }
}
