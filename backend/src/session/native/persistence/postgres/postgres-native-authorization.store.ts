import { Kysely, Selectable } from 'kysely';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import {
  AUTHORIZATION_APPROVAL,
  AUTHORIZATION_DENIAL,
  AuthorizationApproval,
  AuthorizationApprovalOutcome,
  AuthorizationCode,
  AuthorizationDenial,
  AuthorizationDenialGuard,
  CODE_SPEND,
  CodeHolder,
  CodeSpend,
  GRANT_VERSION_CAPTURE,
  GrantVersionCapture,
  NativeAuthorizationStore,
  NewPendingAuthorization,
  PendingAuthorization,
} from '../../authorize/native-authorization.store';
import { NATIVE_AUTH_INTENT } from '../../oauth/native-oauth.types';
import {
  AuthorizationTransactionsTable,
  PostgresTables,
} from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../persistence/postgres/postgres-issuance-mappers';
import { autocommit } from '../../../../auth/persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';

type Row = Selectable<AuthorizationTransactionsTable>;

function toPending(row: Row): PendingAuthorization {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    state: row.state,
    expiresAt: row.expires_at,
  };
}

function toCode(row: Row): AuthorizationCode {
  return {
    id: row.id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    userId: row.user_id,
    codeExpiresAt: row.code_expires_at,
    requestedScopes: row.requested_scopes,
    audience: row.audience,
    authenticationMethods: row.authentication_methods,
    capturedUserVersion: row.captured_user_version,
    capturedClientVersion: row.captured_client_version,
    capturedGrantVersion: row.captured_grant_version,
    authEpoch: row.auth_epoch,
  };
}

/**
 * Every guard is in the statement's `WHERE`, and the outcome is read from
 * `RETURNING`: under read committed a second writer waits for the first and
 * then finds the request already decided.
 *
 * An exchange takes its code at `findUnspentCodeIn` with a row lock, so a
 * second exchange of the same code is refused there at once (`NOWAIT`) and
 * never acts on a code it read before the first one spent it.
 */
export class PostgresNativeAuthorizationStore extends NativeAuthorizationStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async createPending(pending: NewPendingAuthorization): Promise<void> {
    await autocommit({}, () =>
      this.database
        .insertInto('authorization_transactions')
        .values({
          transaction_id: pending.transactionId,
          client_id: pending.clientId,
          redirect_uri: pending.redirectUri,
          code_challenge: pending.codeChallenge,
          state: pending.state,
          requested_scopes: pending.requestedScopes,
          audience: pending.audience,
          intent: NATIVE_AUTH_INTENT,
          expires_at: pending.expiresAt,
          consumed: false,
          auth_epoch: pending.authEpoch,
        })
        .execute(),
    );
  }

  async findPending(
    transactionId: string,
    now: Date,
  ): Promise<PendingAuthorization | null> {
    const row = await autocommit({}, () =>
      this.pending(this.database, transactionId, now),
    );
    return row ? toPending(row) : null;
  }

  async findPendingIn(
    unitOfWork: UnitOfWork,
    transactionId: string,
    now: Date,
  ): Promise<PendingAuthorization | null> {
    const row = await this.pending(
      postgresTransactionOf(unitOfWork),
      transactionId,
      now,
    );
    return row ? toPending(row) : null;
  }

  async approve(
    unitOfWork: UnitOfWork,
    id: string,
    approval: AuthorizationApproval,
  ): Promise<AuthorizationApprovalOutcome> {
    const approved = await postgresTransactionOf(unitOfWork)
      .updateTable('authorization_transactions')
      .set({
        code_hash: approval.codeHash,
        code_expires_at: approval.codeExpiresAt,
        expires_at: approval.codeExpiresAt,
        user_id: toUuid(approval.userId),
        captured_user_version: approval.capturedUserVersion,
        captured_client_version: approval.capturedClientVersion,
        authentication_methods: approval.authenticationMethods,
      })
      .where('id', '=', toUuid(id))
      .where('consumed', '=', false)
      .where('code_hash', 'is', null)
      .where('expires_at', '>', approval.now)
      .returning('id')
      .execute();
    return approved.length === 1
      ? AUTHORIZATION_APPROVAL.APPROVED
      : AUTHORIZATION_APPROVAL.NOT_PENDING;
  }

  async captureGrantVersion(
    unitOfWork: UnitOfWork,
    id: string,
    codeHash: string,
    grantVersion: number,
  ): Promise<GrantVersionCapture> {
    const captured = await postgresTransactionOf(unitOfWork)
      .updateTable('authorization_transactions')
      .set({ captured_grant_version: grantVersion })
      .where('id', '=', toUuid(id))
      .where('consumed', '=', false)
      .where('code_hash', '=', codeHash)
      .returning('id')
      .execute();
    return captured.length === 1
      ? GRANT_VERSION_CAPTURE.CAPTURED
      : GRANT_VERSION_CAPTURE.NOT_APPROVED;
  }

  async deny(
    id: string,
    guard: AuthorizationDenialGuard,
  ): Promise<AuthorizationDenial> {
    const denied = await autocommit({}, () =>
      this.database
        .updateTable('authorization_transactions')
        .set({ consumed: true })
        .where('id', '=', toUuid(id))
        .where('transaction_id', '=', guard.transactionId)
        .where('intent', '=', NATIVE_AUTH_INTENT)
        .where('consumed', '=', false)
        .where('code_hash', 'is', null)
        .where('expires_at', '>', guard.now)
        .where('redirect_uri', '=', guard.redirectUri)
        .returning(['redirect_uri', 'state'])
        .executeTakeFirst(),
    );
    return denied
      ? {
          outcome: AUTHORIZATION_DENIAL.DENIED,
          redirectUri: denied.redirect_uri,
          state: denied.state,
        }
      : { outcome: AUTHORIZATION_DENIAL.NOT_PENDING };
  }

  async findUnspentCode(codeHash: string): Promise<AuthorizationCode | null> {
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('authorization_transactions')
        .selectAll()
        .where('code_hash', '=', codeHash)
        .where('consumed', '=', false)
        .executeTakeFirst(),
    );
    return row ? toCode(row) : null;
  }

  async findCodeHolder(
    codeHash: string,
    now: Date,
  ): Promise<CodeHolder | null> {
    const row = await autocommit({}, () =>
      this.database
        .selectFrom('authorization_transactions')
        .select(['client_id', 'user_id'])
        .where('code_hash', '=', codeHash)
        .where('consumed', '=', false)
        .where('code_expires_at', '>', now)
        .executeTakeFirst(),
    );
    return row ? { clientId: row.client_id, userId: row.user_id } : null;
  }

  spendCode(id: string): Promise<CodeSpend> {
    return autocommit({}, () => this.spend(this.database, id));
  }

  async findUnspentCodeIn(
    unitOfWork: UnitOfWork,
    id: string,
  ): Promise<AuthorizationCode | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('authorization_transactions')
      .selectAll()
      .where('id', '=', toUuid(id))
      .where('consumed', '=', false)
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row ? toCode(row) : null;
  }

  spendCodeIn(unitOfWork: UnitOfWork, id: string): Promise<CodeSpend> {
    return this.spend(postgresTransactionOf(unitOfWork), id);
  }

  private pending(
    executor: Kysely<PostgresTables>,
    transactionId: string,
    now: Date,
  ): Promise<Row | undefined> {
    return executor
      .selectFrom('authorization_transactions')
      .selectAll()
      .where('transaction_id', '=', transactionId)
      .where('intent', '=', NATIVE_AUTH_INTENT)
      .where('consumed', '=', false)
      .where('code_hash', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
  }

  private async spend(
    executor: Kysely<PostgresTables>,
    id: string,
  ): Promise<CodeSpend> {
    const spent = await executor
      .updateTable('authorization_transactions')
      .set({ consumed: true })
      .where('id', '=', toUuid(id))
      .where('consumed', '=', false)
      .returning('id')
      .execute();
    return spent.length === 1 ? CODE_SPEND.SPENT : CODE_SPEND.ALREADY_SPENT;
  }
}
