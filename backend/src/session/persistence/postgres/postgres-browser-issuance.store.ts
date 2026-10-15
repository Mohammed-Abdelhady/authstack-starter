import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { newSecurityEvent } from '../../events/security-event-recorder';
import { SecurityEventStore } from '../../events/security-event.store';
import { AUTH_SCHEMA_VERSION } from '../../constants/session-policy';
import {
  ACCOUNT_ISSUANCE_MARK,
  AccountIssuanceMark,
  BrowserIssuanceStore,
  deviceLabelOf,
  IssuanceAccount,
  IssuanceGrant,
  IssuanceSecurityEvent,
  NewBrowserSession,
  NewIssuanceGrant,
  SessionCapCandidate,
  SessionCapQuery,
} from '../../issuance/browser-issuance.store';
import { toSessionCapCandidate } from './postgres-session-cap';
import { toUuid } from './postgres-issuance-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

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

function toIssuanceGrant(row: GrantRow): IssuanceGrant {
  return {
    id: row.id,
    clientId: row.client_id,
    allowed: row.allowed,
    sessionVersion: row.session_version,
  };
}

/**
 * Takes the account at `readAccountForIssuance` with a row lock, before any
 * version is read or any session is counted. A second unit of work is refused
 * there at once (`NOWAIT`), which the runner reports as a retryable abort.
 *
 * The lock is `FOR NO KEY UPDATE`, the strength an update of the account's
 * versions takes. It keeps sign-ins and version changes apart and leaves rows
 * that only refer to the account, through a foreign key, free to be written.
 */
export class PostgresBrowserIssuanceStore extends BrowserIssuanceStore {
  constructor(
    private readonly environment: string,
    private readonly clock: { now(): Date },
    private readonly events: SecurityEventStore,
  ) {
    super();
  }

  async findAccount(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<IssuanceAccount | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select(['id', 'is_deleted', 'session_version', 'audience'])
      .where('id', '=', toUuid(userId))
      .executeTakeFirst();
    return row
      ? {
          id: row.id,
          isDeleted: row.is_deleted,
          accountAudience: row.audience ?? undefined,
          sessionVersion: row.session_version,
        }
      : null;
  }

  async readAccountForIssuance(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<IssuanceAccount | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select(['id', 'is_deleted', 'session_version', 'audience'])
      .where('id', '=', toUuid(userId))
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      isDeleted: row.is_deleted,
      accountAudience: row.audience ?? undefined,
      sessionVersion: row.session_version,
    };
  }

  async markAccountIssuance(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<AccountIssuanceMark> {
    const marked = await postgresTransactionOf(unitOfWork)
      .updateTable('users')
      .set((column) => ({ issuance_fence: column('issuance_fence', '+', 1) }))
      .where('id', '=', toUuid(userId))
      .returning('id')
      .execute();
    return marked.length === 1
      ? ACCOUNT_ISSUANCE_MARK.MARKED
      : ACCOUNT_ISSUANCE_MARK.ACCOUNT_MISSING;
  }

  async findGrant(
    unitOfWork: UnitOfWork,
    userId: string,
    clientId: string,
  ): Promise<IssuanceGrant | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('user_application_grants')
      .select(GRANT_COLUMNS)
      .where('user_id', '=', toUuid(userId))
      .where('client_id', '=', clientId)
      .executeTakeFirst();
    return row ? toIssuanceGrant(row) : null;
  }

  async createGrant(
    unitOfWork: UnitOfWork,
    grant: NewIssuanceGrant,
  ): Promise<IssuanceGrant> {
    const row = await postgresTransactionOf(unitOfWork)
      .insertInto('user_application_grants')
      .values({
        user_id: toUuid(grant.userId),
        client_id: grant.clientId,
        allowed_scopes: grant.allowedScopes,
        allowed: true,
        session_version: 0,
        issuance_fence: 0,
      })
      .returning(GRANT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toIssuanceGrant(row);
  }

  async markGrantIssuance(
    unitOfWork: UnitOfWork,
    grantId: string,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('user_application_grants')
      .set((column) => ({ issuance_fence: column('issuance_fence', '+', 1) }))
      .where('id', '=', toUuid(grantId))
      .execute();
  }

  async listSessionCapCandidates(
    unitOfWork: UnitOfWork,
    query: SessionCapQuery,
  ): Promise<SessionCapCandidate[]> {
    const rows = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions as s')
      .leftJoin('applications as a', (join) =>
        join
          .onRef('a.client_id', '=', 's.client_id')
          .on('a.environment', '=', this.environment),
      )
      .leftJoin('user_application_grants as g', (join) =>
        join
          .onRef('g.user_id', '=', 's.user_id')
          .onRef('g.client_id', '=', 's.client_id'),
      )
      .select([
        's.is_valid',
        's.proof_key_thumbprint',
        's.user_verified',
        's.policy_version as session_policy_version',
        's.revoked_at',
        's.credential_purpose',
        's.auth_epoch',
        's.schema_version',
        's.client_id',
        's.user_version',
        's.client_version',
        's.grant_version',
        's.authenticated_at',
        's.expires_at',
        's.idle_expires_at',
        's.last_activity_at',
        'a.platform as application_platform',
        'a.enabled as application_enabled',
        'a.session_version as application_session_version',
        'a.allowed_scopes as application_allowed_scopes',
        'a.absolute_lifetime_ms',
        'a.idle_lifetime_ms',
        'a.sign_up',
        'a.require_passkey',
        'a.sign_in_methods',
        'a.account_audience',
        'a.policy_version',
        'a.session_cap',
        'a.unbound_absolute_lifetime_ms',
        'a.unbound_idle_lifetime_ms',
        'g.id as grant_id',
        'g.allowed as grant_allowed',
        'g.session_version as grant_session_version',
      ])
      .where('s.user_id', '=', toUuid(query.userId))
      .where('s.is_valid', '=', true)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', query.now)
      .where('s.idle_expires_at', '>', query.now)
      .where('s.credential_purpose', 'in', query.purposes)
      .where('s.auth_epoch', '=', query.authEpoch)
      .where('s.schema_version', '=', AUTH_SCHEMA_VERSION)
      .where('s.user_version', '=', query.userVersion)
      .execute();
    return rows.map(toSessionCapCandidate);
  }

  async insertBrowserSession(
    unitOfWork: UnitOfWork,
    session: NewBrowserSession,
  ): Promise<string> {
    const row = await postgresTransactionOf(unitOfWork)
      .insertInto('sessions')
      .values({
        user_id: toUuid(session.userId),
        token_hash: Buffer.from(session.tokenHash, 'hex'),
        csrf_token: session.csrfToken,
        user_agent: session.userAgent,
        device: JSON.stringify(deviceLabelOf(session.device)),
        device_name: session.deviceName ?? null,
        ip: session.ip,
        is_valid: true,
        client_id: session.clientId,
        user_version: session.userVersion,
        client_version: session.clientVersion,
        grant_version: session.grantVersion,
        auth_epoch: session.authEpoch,
        schema_version: session.schemaVersion,
        scopes: session.scopes,
        audience: session.audience,
        authentication_methods: session.authenticationMethods,
        user_verified: session.userVerified ?? false,
        policy_version: session.policyVersion ?? 0,
        credential_purpose: session.credentialPurpose,
        browser_generation: session.browserGeneration,
        authenticated_at: session.authenticatedAt,
        last_used_at: session.lastUsedAt,
        last_activity_at: session.lastActivityAt,
        expires_at: session.expiresAt,
        idle_expires_at: session.idleExpiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: IssuanceSecurityEvent,
  ): Promise<void> {
    await this.events.append(
      unitOfWork,
      newSecurityEvent(event, this.clock.now()),
    );
  }
}
