import type { Kysely, Selectable, Transaction } from 'kysely';
import type { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import type { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  ERASURE_STANDING,
  ERASURE_STEP,
  type ErasureStanding,
  type ErasureStep,
} from '../../constants/erasure.constants';
import { ErasureJobStore } from '../../stores/erasure-job.store';
import type {
  BegunErasure,
  ErasureFailure,
  ErasureJob,
  ErasureLease,
} from '../../types/erasure';
import type { ErasureJobsTable } from './postgres-erasure.tables';

type JobRow = Selectable<ErasureJobsTable>;

function stepOf(value: string): ErasureStep {
  const step = Object.values(ERASURE_STEP).find((known) => known === value);
  if (!step) throw new Error('An erasure job holds an unknown step');
  return step;
}

function toJob(row: JobRow): ErasureJob {
  return {
    id: row.id,
    userId: row.user_id,
    step: stepOf(row.step),
    attempts: row.attempts,
    failureCode: row.failure_code,
    failedAt: row.failed_at,
    nextAttemptAt: row.next_attempt_at,
    startedAt: row.started_at,
    erasedAt: row.erased_at,
  };
}

/** A job another worker holds, or one waiting for its retry, is not ours now. */
function isTaken(row: JobRow, lease: ErasureLease): boolean {
  const leasedByOther =
    row.lease_owner !== lease.owner &&
    row.lease_until !== null &&
    row.lease_until > lease.now;
  const waiting =
    row.next_attempt_at !== null && row.next_attempt_at > lease.now;
  return row.step === ERASURE_STEP.ERASED || leasedByOther || waiting;
}

/**
 * Step 1 takes the account row with SKIP LOCKED: a row a restore holds is
 * passed over this run. A restore takes it with NOWAIT, so while step 1 holds
 * it the restore aborts, runs again, and then finds the job.
 */
export class PostgresErasureJobStore extends ErasureJobStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async findDue(now: Date, limit: number): Promise<string[]> {
    const rows = await this.database
      .selectFrom('users as u')
      .leftJoin('erasure_jobs as j', 'j.user_id', 'u.id')
      .select('u.id')
      .where('u.is_deleted', '=', true)
      .where('u.erase_after', '<=', now)
      .where((eb) =>
        eb.or([
          eb('j.id', 'is', null),
          eb.and([
            eb('j.step', '!=', ERASURE_STEP.ERASED),
            eb.or([
              eb('j.lease_until', 'is', null),
              eb('j.lease_until', '<=', now),
            ]),
            eb.or([
              eb('j.next_attempt_at', 'is', null),
              eb('j.next_attempt_at', '<=', now),
            ]),
          ]),
        ]),
      )
      .orderBy('u.erase_after')
      .limit(limit)
      .execute();
    return rows.map((row) => row.id);
  }

  async beginIn(
    unitOfWork: UnitOfWork,
    userId: string,
    lease: ErasureLease,
  ): Promise<BegunErasure | null> {
    const transaction = postgresTransactionOf(unitOfWork);
    const id = toUuid(userId);
    const account = await transaction
      .selectFrom('users')
      .select(['id', 'email', 'pending_email', 'is_deleted', 'erase_after'])
      .where('id', '=', id)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (
      !account?.is_deleted ||
      account.erase_after === null ||
      account.erase_after > lease.now
    ) {
      return null;
    }
    const job = await this.leaseJob(transaction, id, lease);
    if (!job) return null;
    const onAccount = {
      address: account.email,
      pendingAddress: account.pending_email,
    };
    return { job, accountId: id, onAccount };
  }

  /** Writes the job at `erasing`, or leases the one there is when it is free. */
  private async leaseJob(
    transaction: Transaction<PostgresTables>,
    userId: string,
    lease: ErasureLease,
  ): Promise<ErasureJob | null> {
    const existing = await transaction
      .selectFrom('erasure_jobs')
      .selectAll()
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (existing && isTaken(existing, lease)) return null;
    const row = existing
      ? await transaction
          .updateTable('erasure_jobs')
          .set({ lease_owner: lease.owner, lease_until: lease.until })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await transaction
          .insertInto('erasure_jobs')
          .values({
            user_id: userId,
            step: ERASURE_STEP.ERASING,
            started_at: lease.now,
            lease_owner: lease.owner,
            lease_until: lease.until,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
    return toJob(row);
  }

  async markHookDone(jobId: string, lease: ErasureLease): Promise<boolean> {
    const done = await this.database
      .updateTable('erasure_jobs')
      .set({ step: ERASURE_STEP.HOOK_DONE })
      .where('id', '=', toUuid(jobId))
      .where('lease_owner', '=', lease.owner)
      .where('step', '=', ERASURE_STEP.ERASING)
      .returning('id')
      .executeTakeFirst();
    return done !== undefined;
  }

  async markFailed(
    jobId: string,
    owner: string,
    failure: ErasureFailure,
  ): Promise<void> {
    await this.database
      .updateTable('erasure_jobs')
      .set((eb) => ({
        attempts: eb('attempts', '+', 1),
        failure_code: failure.code,
        failed_at: failure.at,
        next_attempt_at: failure.nextAttemptAt,
        lease_owner: null,
        lease_until: null,
      }))
      .where('id', '=', toUuid(jobId))
      .where('lease_owner', '=', owner)
      .where('step', '!=', ERASURE_STEP.ERASED)
      .execute();
  }

  async finishIn(
    unitOfWork: UnitOfWork,
    jobId: string,
    erasedAt: Date,
    purgeAfter: Date,
  ): Promise<boolean> {
    const finished = await postgresTransactionOf(unitOfWork)
      .updateTable('erasure_jobs')
      .set({
        step: ERASURE_STEP.ERASED,
        erased_at: erasedAt,
        purge_after: purgeAfter,
        next_attempt_at: null,
        lease_owner: null,
        lease_until: null,
      })
      .where('id', '=', toUuid(jobId))
      .where('step', '!=', ERASURE_STEP.ERASED)
      .returning('id')
      .executeTakeFirst();
    return finished !== undefined;
  }

  async withdrawIn(unitOfWork: UnitOfWork, jobId: string): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .deleteFrom('erasure_jobs')
      .where('id', '=', toUuid(jobId))
      .where('step', '!=', ERASURE_STEP.ERASED)
      .execute();
  }

  async holdForRestoreIn(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<ErasureStanding> {
    const transaction = postgresTransactionOf(unitOfWork);
    const id = toUuid(userId);
    await transaction
      .selectFrom('users')
      .select('id')
      .where('id', '=', id)
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    const job = await transaction
      .selectFrom('erasure_jobs')
      .select('step')
      .where('user_id', '=', id)
      .executeTakeFirst();
    // A job exists only once step 1 committed, and nothing undoes that.
    if (job) return ERASURE_STANDING.ERASING;
    await transaction
      .updateTable('users')
      .set({ erase_after: null })
      .where('id', '=', id)
      .execute();
    return ERASURE_STANDING.RESTORABLE;
  }

  async listOpen(limit: number): Promise<ErasureJob[]> {
    const rows = await this.database
      .selectFrom('erasure_jobs')
      .selectAll()
      .where('step', '!=', ERASURE_STEP.ERASED)
      .orderBy('started_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toJob);
  }

  async scheduleUnscheduled(eraseAfter: Date, limit: number): Promise<number> {
    const updated = await this.database
      .updateTable('users')
      .set({ erase_after: eraseAfter })
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('users')
          .select('id')
          .where('is_deleted', '=', true)
          .where('erase_after', 'is', null)
          .limit(limit),
      )
      // Again on the row itself: a restore that commits while this waits for
      // the row is seen here, and its account is not scheduled.
      .where('is_deleted', '=', true)
      .where('erase_after', 'is', null)
      .executeTakeFirst();
    return Number(updated.numUpdatedRows);
  }
}
