import type { MigrateDatabases } from '../../src/common/persistence/postgres/postgres-migrate.harness-spec';

type MigrationPool = Awaited<ReturnType<MigrateDatabases['emptyDatabase']>>;
import {
  applyPostgresMigrations,
  listPostgresMigrations,
  MIGRATION_LOCK_WAIT_MS,
} from '../../src/common/persistence/postgres/postgres-migrations';

export const ACTIVITY_MIGRATION = '0027_activity_log.sql';
export const LEGACY_TARGET = 'retained-target';
export const LEGACY_TIME = new Date('2099-01-01T12:00:00.000Z');
export const LEGACY_PURGE = new Date('2099-04-01T12:00:00.000Z');
export const ACTIVITY_KIND_INDEX = 'security_event_kind_time';

export async function prepareLegacyActivity(
  pool: MigrationPool,
): Promise<void> {
  await applyPostgresMigrations(
    pool,
    MIGRATION_LOCK_WAIT_MS,
    listPostgresMigrations().filter((name) => name !== ACTIVITY_MIGRATION),
  );
  await pool.query(
    `INSERT INTO security_events
       (event_id, actor_id, target_user_id, client_id, session_id, action,
        reason_code, request_id, outcome, occurred_at, purge_after,
        assigned_role_id, previous_role_id, assignment_session_version,
        deleted_role_id, deleted_role_slug, deletion_sweep_id, deletion_pending)
     VALUES
       ('assignment-before', 'staff-before', $1, 'admin', 'session-before',
        'sessions_revoked_all', 'admin_forced', 'request-before', 'succeeded',
        $2, $3, 'assigned-before', 'previous-before', 7, NULL, NULL, NULL, NULL),
       ('role-deletion:deleted-before', 'staff-before', $1, NULL, NULL,
        'role_deleted', NULL, NULL, 'succeeded', $2, $3,
        NULL, NULL, NULL, 'deleted-before', 'old-slug', 'sweep-before', true)`,
    [LEGACY_TARGET, LEGACY_TIME, LEGACY_PURGE],
  );
}

export async function legacyEvidence(pool: MigrationPool) {
  return (
    await pool.query<{
      event_id: string;
      actor_id: string;
      target_user_id: string;
      client_id: string | null;
      session_id: string | null;
      action: string;
      reason_code: string | null;
      request_id: string | null;
      outcome: string;
      occurred_at: Date;
      purge_after: Date;
      assigned_role_id: string | null;
      previous_role_id: string | null;
      assignment_session_version: number | null;
      deleted_role_id: string | null;
      deleted_role_slug: string | null;
      deletion_sweep_id: string | null;
      deletion_pending: boolean | null;
    }>(
      `SELECT event_id, actor_id, target_user_id, client_id, session_id, action,
              reason_code, request_id, outcome, occurred_at, purge_after,
              assigned_role_id, previous_role_id, assignment_session_version,
              deleted_role_id, deleted_role_slug, deletion_sweep_id, deletion_pending
         FROM security_events ORDER BY event_id`,
    )
  ).rows;
}
