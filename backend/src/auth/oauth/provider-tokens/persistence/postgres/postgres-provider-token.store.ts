import { sql, type Kysely, type Selectable } from 'kysely';
import { MalformedIdError } from '../../../../../common/persistence/persistence-errors';
import type { UnitOfWork } from '../../../../../common/persistence/unit-of-work';
import type { PostgresTables } from '../../../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../../../common/persistence/postgres/postgres-unit-of-work';
import { toUuid } from '../../../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  REVOCATION_OUTCOME,
  REVOCATION_STATE,
  type RevocationOutcome,
} from '../../constants/provider-tokens.constants';
import { ProviderTokenStore } from '../../stores/provider-token.store';
import type {
  DueRevocation,
  KeptProviderToken,
  NewRevocationJob,
  ProviderRevocationJob,
  RevocationFailure,
  TokenToKeep,
} from '../../types/provider-tokens';
import { revocationJobOf } from '../revocation-job-fields';
import type {
  ProviderRevocationsTable,
  ProviderTokensTable,
} from './postgres-provider-token.tables';

type RevocationRow = Selectable<ProviderRevocationsTable>;

function keptOf(row: Selectable<ProviderTokensTable>): KeptProviderToken {
  return {
    provider: row.provider,
    subject: row.subject,
    clientId: row.client_id,
    sealed: {
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
      keyId: row.key_id,
    },
    storedAt: row.stored_at,
  };
}

function jobRow(job: NewRevocationJob) {
  const pending = job.sealed !== undefined;
  return {
    provider: job.provider,
    subject: job.subject,
    client_id: job.clientId,
    user_id: job.userId === null ? null : toUuid(job.userId),
    reason: job.reason,
    state: pending ? REVOCATION_STATE.PENDING : REVOCATION_STATE.CLOSED,
    outcome: pending ? null : REVOCATION_OUTCOME.NO_TOKEN,
    ciphertext: job.sealed?.ciphertext ?? null,
    iv: job.sealed?.iv ?? null,
    tag: job.sealed?.tag ?? null,
    key_id: job.sealed?.keyId ?? null,
    next_attempt_at: pending ? job.createdAt : null,
    created_at: job.createdAt,
    settled_at: pending ? null : job.createdAt,
    purge_after: job.purgeAfter,
  };
}

function toJob(row: RevocationRow): ProviderRevocationJob {
  return revocationJobOf({
    id: row.id,
    provider: row.provider,
    userId: row.user_id,
    reason: row.reason,
    state: row.state,
    outcome: row.outcome,
    attempts: row.attempts,
    failureCode: row.failure_code,
    flaggedAt: row.flagged_at,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    settledAt: row.settled_at,
  });
}

/** An id this database could not have issued names no job. */
function jobIdOf(jobId: string): string | null {
  try {
    return toUuid(jobId);
  } catch (error) {
    if (error instanceof MalformedIdError) return null;
    throw error;
  }
}

export class PostgresProviderTokenStore extends ProviderTokenStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async keep(token: TokenToKeep): Promise<void> {
    const sealed = {
      ciphertext: token.sealed.ciphertext,
      iv: token.sealed.iv,
      tag: token.sealed.tag,
      key_id: token.sealed.keyId,
      stored_at: token.storedAt,
      check_after: token.checkAfter,
    };
    await this.database
      .insertInto('provider_tokens')
      .values({
        provider: token.provider,
        subject: token.subject,
        client_id: token.clientId,
        ...sealed,
      })
      .onConflict((conflict) =>
        conflict
          .columns(['provider', 'subject', 'client_id'])
          .doUpdateSet(sealed),
      )
      .execute();
  }

  async takeTokensIn(
    unitOfWork: UnitOfWork,
    identity: { provider: string; subject: string },
  ): Promise<KeptProviderToken[]> {
    const rows = await postgresTransactionOf(unitOfWork)
      .deleteFrom('provider_tokens')
      .where('provider', '=', identity.provider)
      .where('subject', '=', identity.subject)
      .returningAll()
      .execute();
    return rows.map(keptOf);
  }

  async takeUnclaimedIn(
    unitOfWork: UnitOfWork,
    now: Date,
    limit: number,
  ): Promise<{ checked: number; unclaimed: KeptProviderToken[] }> {
    const transaction = postgresTransactionOf(unitOfWork);
    const due = await transaction
      .selectFrom('provider_tokens as t')
      .select((eb) => [
        't.id',
        eb
          .exists(
            eb
              .selectFrom('user_linked_accounts as l')
              .select('l.user_id')
              .whereRef('l.provider', '=', 't.provider')
              .whereRef('l.provider_id', '=', 't.subject'),
          )
          .as('linked'),
      ])
      .where('t.check_after', '<=', now)
      .orderBy('t.check_after')
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    const linked = due.filter((row) => row.linked).map((row) => row.id);
    const unlinked = due.filter((row) => !row.linked).map((row) => row.id);
    if (linked.length > 0) {
      await transaction
        .updateTable('provider_tokens')
        .set({ check_after: null })
        .where('id', 'in', linked)
        .execute();
    }
    const taken =
      unlinked.length === 0
        ? []
        : await transaction
            .deleteFrom('provider_tokens')
            .where('id', 'in', unlinked)
            .returningAll()
            .execute();
    return { checked: due.length, unclaimed: taken.map(keptOf) };
  }

  async addJobsIn(
    unitOfWork: UnitOfWork,
    jobs: NewRevocationJob[],
  ): Promise<void> {
    if (jobs.length === 0) return;
    await postgresTransactionOf(unitOfWork)
      .insertInto('provider_revocations')
      .values(jobs.map(jobRow))
      .execute();
  }

  async claimDue(
    now: Date,
    limit: number,
    leaseUntil: Date,
  ): Promise<DueRevocation[]> {
    const rows = await this.database
      .updateTable('provider_revocations')
      .set({ lease_until: leaseUntil })
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('provider_revocations')
          .select('id')
          .where('state', '=', REVOCATION_STATE.PENDING)
          .where((due) =>
            due.or([
              due('next_attempt_at', 'is', null),
              due('next_attempt_at', '<=', now),
            ]),
          )
          .where((free) =>
            free.or([
              free('lease_until', 'is', null),
              free('lease_until', '<=', now),
            ]),
          )
          .orderBy('created_at')
          .limit(limit)
          .forUpdate()
          .skipLocked(),
      )
      .returningAll()
      .execute();
    return rows.flatMap((row) =>
      row.client_id && row.ciphertext && row.iv && row.tag && row.key_id
        ? [
            {
              id: row.id,
              provider: row.provider,
              subject: row.subject,
              clientId: row.client_id,
              sealed: {
                ciphertext: row.ciphertext,
                iv: row.iv,
                tag: row.tag,
                keyId: row.key_id,
              },
              attempts: row.attempts,
            },
          ]
        : [],
    );
  }

  async settle(
    jobId: string,
    outcome: RevocationOutcome,
    at: Date,
  ): Promise<boolean> {
    const id = jobIdOf(jobId);
    if (id === null) return false;
    const settled = await this.database
      .updateTable('provider_revocations')
      .set({
        state:
          outcome === REVOCATION_OUTCOME.REVOKED
            ? REVOCATION_STATE.REVOKED
            : REVOCATION_STATE.CLOSED,
        outcome,
        settled_at: at,
        ciphertext: null,
        iv: null,
        tag: null,
        key_id: null,
        next_attempt_at: null,
        lease_until: null,
      })
      .where('id', '=', id)
      .where('state', '=', REVOCATION_STATE.PENDING)
      .returning('id')
      .executeTakeFirst();
    return settled !== undefined;
  }

  async markFailed(jobId: string, failure: RevocationFailure): Promise<void> {
    await this.database
      .updateTable('provider_revocations')
      .set((eb) => ({
        attempts: eb('attempts', '+', 1),
        failure_code: failure.code,
        next_attempt_at: failure.nextAttemptAt,
        lease_until: null,
        flagged_at: failure.flag
          ? sql<Date>`COALESCE(flagged_at, ${failure.at})`
          : sql<Date | null>`flagged_at`,
      }))
      .where('id', '=', toUuid(jobId))
      .where('state', '=', REVOCATION_STATE.PENDING)
      .execute();
  }

  async listFlagged(limit: number): Promise<ProviderRevocationJob[]> {
    const rows = await this.database
      .selectFrom('provider_revocations')
      .selectAll()
      .where('state', '=', REVOCATION_STATE.PENDING)
      .where('flagged_at', 'is not', null)
      .orderBy('flagged_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toJob);
  }
}
