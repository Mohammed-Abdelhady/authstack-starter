import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  newSecurityEvent,
  RecordSecurityEventInput,
} from '../../events/security-event-recorder';
import { SecurityEventStore } from '../../events/security-event.store';
import {
  ACCOUNT_VERSION_ADVANCE,
  AccountVersionAdvance,
  LiveSessionCount,
  RevocableSession,
  RevocationAccount,
  SESSION_REVOCATION,
  SessionRevocationMark,
  SessionRevocationOutcome,
  SessionRevocationStore,
  SURVIVOR_PROMOTION,
  SurvivorPromotion,
} from '../../revocation/session-revocation.store';
import { toUuid } from './postgres-issuance-mappers';
import {
  REVOCABLE_SESSION_COLUMNS,
  toRevocableSession,
} from './postgres-session-rows';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

/**
 * Takes the account at `readAccountForRevocation` with the row lock sign-in
 * takes, before the version is read or a session is counted, and takes a
 * session with the same kind of lock at the read that finds it. A second unit
 * of work is refused there at once (`NOWAIT`), which the runner reports as a
 * retryable abort. No statement here waits for another unit of work.
 */
export class PostgresSessionRevocationStore extends SessionRevocationStore {
  constructor(
    private readonly clock: { now(): Date },
    private readonly events: SecurityEventStore,
  ) {
    super();
  }

  async readAccountForRevocation(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<RevocationAccount | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select(['id', 'session_version'])
      .where('id', '=', toUuid(userId))
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row ? { id: row.id, sessionVersion: row.session_version } : null;
  }

  async countLiveSessions(
    unitOfWork: UnitOfWork,
    query: LiveSessionCount,
  ): Promise<number> {
    const counted = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions')
      .select((session) => session.fn.countAll<string>().as('total'))
      .where('user_id', '=', toUuid(query.userId))
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', query.now)
      .where('idle_expires_at', '>', query.now)
      .where('user_version', '=', query.userVersion)
      .executeTakeFirstOrThrow();
    return Number.parseInt(counted.total, 10);
  }

  async advanceAccountVersion(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .updateTable('users')
      .set((column) => ({
        session_version: column('session_version', '+', 1),
      }))
      .where('id', '=', toUuid(userId))
      .execute();
  }

  async advanceAccountVersionFrom(
    unitOfWork: UnitOfWork,
    userId: string,
    expected: number,
  ): Promise<AccountVersionAdvance> {
    const advanced = await postgresTransactionOf(unitOfWork)
      .updateTable('users')
      .set({ session_version: expected + 1 })
      .where('id', '=', toUuid(userId))
      .where('session_version', '=', expected)
      .returning('id')
      .execute();
    return advanced.length === 1
      ? ACCOUNT_VERSION_ADVANCE.ADVANCED
      : ACCOUNT_VERSION_ADVANCE.VERSION_MOVED;
  }

  async findLiveSessionByTokenHash(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<RevocableSession | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions')
      .select(REVOCABLE_SESSION_COLUMNS)
      .where('token_hash', '=', Buffer.from(tokenHash, 'hex'))
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row ? toRevocableSession(row) : null;
  }

  async findLiveSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<RevocableSession | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions')
      .select(REVOCABLE_SESSION_COLUMNS)
      .where('id', '=', toUuid(sessionId))
      .where('user_id', '=', toUuid(userId))
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row ? toRevocableSession(row) : null;
  }

  async findSessionOfAccount(
    unitOfWork: UnitOfWork,
    sessionId: string,
    userId: string,
  ): Promise<RevocableSession | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('sessions')
      .select(REVOCABLE_SESSION_COLUMNS)
      .where('id', '=', toUuid(sessionId))
      .where('user_id', '=', toUuid(userId))
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return row ? toRevocableSession(row) : null;
  }

  async revokeSession(
    unitOfWork: UnitOfWork,
    sessionId: string,
    mark: SessionRevocationMark,
  ): Promise<SessionRevocationOutcome> {
    const revoked = await postgresTransactionOf(unitOfWork)
      .updateTable('sessions')
      .set({
        is_valid: false,
        revoked_at: mark.at,
        revoked_reason: mark.reason,
      })
      .where('id', '=', toUuid(sessionId))
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .returning('id')
      .execute();
    return revoked.length === 1
      ? SESSION_REVOCATION.REVOKED
      : SESSION_REVOCATION.NOT_LIVE;
  }

  async promoteSurvivor(
    unitOfWork: UnitOfWork,
    sessionId: string,
    versions: { from: number; to: number },
  ): Promise<SurvivorPromotion> {
    const promoted = await postgresTransactionOf(unitOfWork)
      .updateTable('sessions')
      .set({ user_version: versions.to })
      .where('id', '=', toUuid(sessionId))
      .where('is_valid', '=', true)
      .where('revoked_at', 'is', null)
      .where('user_version', '=', versions.from)
      .returning('id')
      .execute();
    return promoted.length === 1
      ? SURVIVOR_PROMOTION.PROMOTED
      : SURVIVOR_PROMOTION.NOT_LIVE;
  }

  async appendSecurityEvent(
    unitOfWork: UnitOfWork,
    event: RecordSecurityEventInput,
  ): Promise<void> {
    await this.events.append(
      unitOfWork,
      newSecurityEvent(event, this.clock.now()),
    );
  }
}
