import { randomUUID } from 'node:crypto';
import { Kysely, Selectable } from 'kysely';
import { Clock } from '../../../../common/services/clock';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { NATIVE_ATTEMPT_PHASE } from '../../constants/native-attempt';
import { NativeAttemptStore } from '../../stores/native-attempt.store';
import {
  assertNativeAttemptSecretHash,
  nativeAttemptDetails,
} from '../native-attempt-fields';
import {
  NativeAttempt,
  NativeAttemptCredentials,
  NativeAttemptDetails,
  NativeAttemptFlow,
  NativeAttemptGuard,
  NativeAttemptOperationGuard,
  NativeAttemptPhase,
  NativeAttemptTransition,
  NewNativeAttempt,
} from '../../types/native-attempt';
import { NativeAttemptsTable } from './postgres-native-attempt.table';

type Row = Selectable<NativeAttemptsTable>;

function reviveDetails(details: NativeAttemptDetails): NativeAttemptDetails {
  return {
    ...details,
    verifiedAccount: details.verifiedAccount
      ? {
          ...details.verifiedAccount,
          verifiedAt: new Date(details.verifiedAccount.verifiedAt),
        }
      : null,
    email: details.email
      ? {
          ...details.email,
          requestedAt: details.email.requestedAt
            ? new Date(details.email.requestedAt)
            : null,
        }
      : null,
    codeReply: details.codeReply
      ? {
          ...details.codeReply,
          expiresAt: new Date(details.codeReply.expiresAt),
        }
      : null,
  };
}

function toAttempt(row: Row): NativeAttempt {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    secretHash: row.secret_hash,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    state: row.state,
    requestedScopes: row.requested_scopes,
    flow: row.flow as NativeAttemptFlow,
    phase: row.phase as NativeAttemptPhase,
    authEpoch: row.auth_epoch,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revision: row.revision,
    activeOperationId: row.active_operation_id,
    cancelledAt: row.cancelled_at,
    details: reviveDetails(row.details),
  };
}

export class PostgresNativeAttemptStore extends NativeAttemptStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: Clock,
  ) {
    super();
  }

  async create(input: NewNativeAttempt): Promise<NativeAttempt> {
    assertNativeAttemptSecretHash(input.secretHash);
    const row = await this.database
      .insertInto('native_attempts')
      .values({
        id: randomUUID(),
        attempt_id: input.attemptId,
        secret_hash: input.secretHash,
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        code_challenge: input.codeChallenge,
        state: input.state,
        requested_scopes: input.requestedScopes,
        flow: input.flow,
        phase: input.phase,
        auth_epoch: input.authEpoch,
        created_at: input.createdAt,
        expires_at: input.expiresAt,
        revision: 0,
        active_operation_id: null,
        cancelled_at: null,
        details: JSON.stringify(nativeAttemptDetails(input.details)),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toAttempt(row);
  }

  async findByCredentials(
    credentials: NativeAttemptCredentials,
  ): Promise<NativeAttempt | null> {
    const row = await this.live(this.database, credentials)
      .selectAll()
      .executeTakeFirst();
    return row ? toAttempt(row) : null;
  }

  claim(
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null> {
    return this.claimWith(this.database, guard, operationId);
  }

  claimIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null> {
    return this.claimWith(
      postgresTransactionOf(unitOfWork),
      guard,
      operationId,
    );
  }

  release(guard: NativeAttemptOperationGuard): Promise<boolean> {
    return this.releaseWith(this.database, guard);
  }

  releaseIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptOperationGuard,
  ): Promise<boolean> {
    return this.releaseWith(postgresTransactionOf(unitOfWork), guard);
  }

  transition(
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null> {
    return this.transitionWith(this.database, guard, next);
  }

  transitionIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null> {
    return this.transitionWith(postgresTransactionOf(unitOfWork), guard, next);
  }

  cancel(guard: NativeAttemptGuard): Promise<boolean> {
    return this.cancelWith(this.database, guard);
  }

  cancelIn(
    unitOfWork: UnitOfWork,
    guard: NativeAttemptGuard,
  ): Promise<boolean> {
    return this.cancelWith(postgresTransactionOf(unitOfWork), guard);
  }

  private live(
    database: Kysely<PostgresTables>,
    credentials: NativeAttemptCredentials,
  ) {
    return database
      .selectFrom('native_attempts')
      .where('attempt_id', '=', credentials.attemptId)
      .where('client_id', '=', credentials.clientId)
      .where('secret_hash', '=', credentials.secretHash)
      .where('expires_at', '>', this.clock.now())
      .where('cancelled_at', 'is', null)
      .where('phase', '!=', NATIVE_ATTEMPT_PHASE.DENIED);
  }

  private guarded(database: Kysely<PostgresTables>, guard: NativeAttemptGuard) {
    return database
      .updateTable('native_attempts')
      .where('attempt_id', '=', guard.attemptId)
      .where('client_id', '=', guard.clientId)
      .where('secret_hash', '=', guard.secretHash)
      .where('revision', '=', guard.revision)
      .where('expires_at', '>', this.clock.now())
      .where('cancelled_at', 'is', null)
      .where('phase', 'not in', [
        NATIVE_ATTEMPT_PHASE.DENIED,
        NATIVE_ATTEMPT_PHASE.CODE_READY,
      ]);
  }

  private async claimWith(
    database: Kysely<PostgresTables>,
    guard: NativeAttemptGuard,
    operationId: string,
  ): Promise<NativeAttempt | null> {
    const row = await this.guarded(database, guard)
      .set({ active_operation_id: operationId, revision: guard.revision + 1 })
      .where('active_operation_id', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row ? toAttempt(row) : null;
  }

  private async releaseWith(
    database: Kysely<PostgresTables>,
    guard: NativeAttemptOperationGuard,
  ): Promise<boolean> {
    const row = await this.guarded(database, guard)
      .set({ active_operation_id: null, revision: guard.revision + 1 })
      .where('active_operation_id', '=', guard.operationId)
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  private async transitionWith(
    database: Kysely<PostgresTables>,
    guard: NativeAttemptOperationGuard,
    next: NativeAttemptTransition,
  ): Promise<NativeAttempt | null> {
    if (next.expiresAt.getTime() <= this.clock.now().getTime()) return null;
    const row = await this.guarded(database, guard)
      .set({
        phase: next.phase,
        expires_at: next.expiresAt,
        details: JSON.stringify(nativeAttemptDetails(next.details)),
        active_operation_id: null,
        revision: guard.revision + 1,
      })
      .where('active_operation_id', '=', guard.operationId)
      .where('expires_at', '>=', next.expiresAt)
      .returningAll()
      .executeTakeFirst();
    return row ? toAttempt(row) : null;
  }

  private async cancelWith(
    database: Kysely<PostgresTables>,
    guard: NativeAttemptGuard,
  ): Promise<boolean> {
    const row = await this.guarded(database, guard)
      .set({
        phase: NATIVE_ATTEMPT_PHASE.DENIED,
        cancelled_at: this.clock.now(),
        active_operation_id: null,
        revision: guard.revision + 1,
      })
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }
}
