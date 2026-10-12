import { Kysely } from 'kysely';
import {
  AccountIdentity,
  AccountNotHandedOutError,
  AuthorityAccount,
  AuthorityGrant,
  IDLE_EXTENSION,
  IdleExtension,
  IdleExtensionOutcome,
  SessionAuthorityStore,
  SessionCandidateQuery,
  StoredSession,
} from '../../authority/session-authority.store';
import { AUTH_SCHEMA_VERSION } from '../../constants/session-policy';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from './postgres-issuance-mappers';
import { autocommit } from '../../../auth/persistence/postgres/postgres-pending-codes-database';
import {
  STORED_SESSION_COLUMNS,
  toStoredSession,
} from './postgres-session-rows';

const GRANT_COLUMNS = [
  'id',
  'client_id',
  'allowed',
  'session_version',
] as const;

interface GrantRow {
  id: string;
  client_id: string;
  allowed: boolean;
  session_version: number;
}

const IDENTITY_COLUMNS = [
  'id',
  'is_deleted',
  'session_version',
  'email',
  'name',
  'role',
  'permissions',
  'is_verified',
] as const;

interface IdentityRow {
  id: string;
  is_deleted: boolean;
  session_version: number;
  email: string | null;
  name: string | null;
  role: string;
  permissions: string[];
  is_verified: boolean;
}

function toAccountIdentity(row: IdentityRow): AccountIdentity {
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name ?? '',
    role: row.role,
    permissions: [...row.permissions],
    isVerified: row.is_verified,
    isDeleted: row.is_deleted,
  };
}

/** One statement that commits by itself. None of these can meet a unique rule. */
function alone<Result>(statement: () => Promise<Result>): Promise<Result> {
  return autocommit({}, statement);
}

function toAuthorityGrant(row: GrantRow): AuthorityGrant {
  return {
    id: row.id,
    clientId: row.client_id,
    allowed: row.allowed,
    sessionVersion: row.session_version,
  };
}

/**
 * A committed authority read is one statement sent to the primary by itself,
 * never on a transaction's connection. Read committed gives each statement a
 * snapshot taken when it starts, holding every transaction the primary had
 * committed by then. A revocation returns only after the primary has answered
 * its COMMIT, so a read that starts afterwards holds it, and a read made while
 * an older unit of work is still open is not held back to that unit's view.
 *
 * `database` must be the primary. A replica can lag behind a commit the
 * primary has already answered and would break the guarantee.
 */
export class PostgresSessionAuthorityStore extends SessionAuthorityStore {
  /** What each committed account read saw, for the request that asks next. */
  private readonly identities = new WeakMap<
    AuthorityAccount,
    AccountIdentity
  >();

  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async readCommittedSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    return this.findSessionByTokenHash(tokenHash);
  }

  async readCommittedSessionById(
    sessionId: string,
  ): Promise<StoredSession | null> {
    return this.findSessionById(sessionId);
  }

  async readCommittedAccount(userId: string): Promise<AuthorityAccount | null> {
    const row = await this.readIdentityRow(userId);
    if (!row) {
      return null;
    }
    const account: AuthorityAccount = {
      id: row.id,
      isDeleted: row.is_deleted,
      sessionVersion: row.session_version,
    };
    this.identities.set(account, toAccountIdentity(row));
    return account;
  }

  describeAccount(account: AuthorityAccount): Promise<AccountIdentity | null> {
    const held = this.identities.get(account);
    if (!held) {
      return Promise.reject(new AccountNotHandedOutError());
    }
    return Promise.resolve(held);
  }

  private readIdentityRow(userId: string): Promise<IdentityRow | undefined> {
    const id = toUuid(userId);
    return alone(() =>
      this.database
        .selectFrom('users')
        .select(IDENTITY_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst(),
    );
  }

  async readCommittedGrant(
    userId: string,
    clientId: string,
  ): Promise<AuthorityGrant | null> {
    const id = toUuid(userId);
    const row = await alone(() =>
      this.database
        .selectFrom('user_application_grants')
        .select(GRANT_COLUMNS)
        .where('user_id', '=', id)
        .where('client_id', '=', clientId)
        .executeTakeFirst(),
    );
    return row ? toAuthorityGrant(row) : null;
  }

  async readCommittedGrants(
    userId: string,
    clientIds: string[],
  ): Promise<AuthorityGrant[]> {
    const id = toUuid(userId);
    if (clientIds.length === 0) {
      return [];
    }
    const rows = await alone(() =>
      this.database
        .selectFrom('user_application_grants')
        .select(GRANT_COLUMNS)
        .where('user_id', '=', id)
        .where('client_id', 'in', clientIds)
        .execute(),
    );
    return rows.map(toAuthorityGrant);
  }

  async listSessionCandidates(
    query: SessionCandidateQuery,
  ): Promise<StoredSession[]> {
    const id = toUuid(query.userId);
    const rows = await alone(() =>
      this.database
        .selectFrom('sessions')
        .select(STORED_SESSION_COLUMNS)
        .where('user_id', '=', id)
        .where('is_valid', '=', true)
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', query.now)
        .where('idle_expires_at', '>', query.now)
        .where('credential_purpose', 'in', query.purposes)
        .where('auth_epoch', '=', query.authEpoch)
        .where('schema_version', '=', AUTH_SCHEMA_VERSION)
        .where('user_version', '=', query.userVersion)
        .orderBy('last_used_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
    );
    return rows.map(toStoredSession);
  }

  async findSessionById(sessionId: string): Promise<StoredSession | null> {
    const id = toUuid(sessionId);
    const row = await alone(() =>
      this.database
        .selectFrom('sessions')
        .select(STORED_SESSION_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst(),
    );
    return row ? toStoredSession(row) : null;
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<StoredSession | null> {
    const row = await alone(() =>
      this.database
        .selectFrom('sessions')
        .select(STORED_SESSION_COLUMNS)
        .where('token_hash', '=', Buffer.from(tokenHash, 'hex'))
        .executeTakeFirst(),
    );
    return row ? toStoredSession(row) : null;
  }

  async extendIdle(
    sessionId: string,
    extension: IdleExtension,
  ): Promise<IdleExtensionOutcome> {
    const id = toUuid(sessionId);
    const { now, idleExpiresAt } = extension;
    const extended = await alone(() =>
      this.database
        .updateTable('sessions')
        .set({
          last_used_at: now,
          last_activity_at: now,
          idle_expires_at: idleExpiresAt,
        })
        .where('id', '=', id)
        .where('is_valid', '=', true)
        .where('revoked_at', 'is', null)
        .where('idle_expires_at', '>', now)
        .where('expires_at', '>', now)
        .returning('id')
        .execute(),
    );
    return extended.length === 1
      ? IDLE_EXTENSION.EXTENDED
      : IDLE_EXTENSION.NOT_LIVE;
  }
}
