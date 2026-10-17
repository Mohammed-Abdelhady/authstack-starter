import { openPostgresDatabase } from '../../src/common/persistence/postgres/postgres-database';
import { applyPostgresMigrations } from '../../src/common/persistence/postgres/postgres-migrations';
import {
  MIGRATE_CASE_TIMEOUT_MS,
  useMigrateDatabases,
} from '../../src/common/persistence/postgres/postgres-migrate.harness-spec';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import {
  ACTIVITY_KIND_INDEX,
  ACTIVITY_MIGRATION,
  legacyEvidence,
  LEGACY_PURGE,
  LEGACY_TARGET,
  LEGACY_TIME,
  prepareLegacyActivity,
} from './activity-upgrade-fixtures';

// A populated upgrade must preserve the records used to repair role changes.
describe('activity log populated PostgreSQL upgrade', () => {
  const { emptyDatabase, recorded } = useMigrateDatabases();

  it(
    'b18 preserves legacy evidence and reads old rows as sign-in with empty details',
    async () => {
      const pool = await emptyDatabase();
      await prepareLegacyActivity(pool);

      expect(await applyPostgresMigrations(pool)).toEqual([ACTIVITY_MIGRATION]);
      expect(await legacyEvidence(pool)).toEqual([
        {
          event_id: 'assignment-before',
          actor_id: 'staff-before',
          target_user_id: 'retained-target',
          client_id: 'admin',
          session_id: 'session-before',
          action: 'sessions_revoked_all',
          reason_code: 'admin_forced',
          request_id: 'request-before',
          outcome: 'succeeded',
          occurred_at: LEGACY_TIME,
          purge_after: LEGACY_PURGE,
          assigned_role_id: 'assigned-before',
          previous_role_id: 'previous-before',
          assignment_session_version: 7,
          deleted_role_id: null,
          deleted_role_slug: null,
          deletion_sweep_id: null,
          deletion_pending: null,
        },
        {
          event_id: 'role-deletion:deleted-before',
          actor_id: 'staff-before',
          target_user_id: 'retained-target',
          client_id: null,
          session_id: null,
          action: 'role_deleted',
          reason_code: null,
          request_id: null,
          outcome: 'succeeded',
          occurred_at: LEGACY_TIME,
          purge_after: LEGACY_PURGE,
          assigned_role_id: null,
          previous_role_id: null,
          assignment_session_version: null,
          deleted_role_id: 'deleted-before',
          deleted_role_slug: 'old-slug',
          deletion_sweep_id: 'sweep-before',
          deletion_pending: true,
        },
      ]);
      const store = new PostgresSecurityEventStore(openPostgresDatabase(pool));
      const rows = await store.listRecentForUser(LEGACY_TARGET, 10);
      expect(
        rows.map(
          ({ eventId, kind, details, roleAssignment, roleDeletionSweep }) => ({
            eventId,
            kind,
            details,
            roleAssignment,
            roleDeletionSweep,
          }),
        ),
      ).toEqual([
        {
          eventId: 'role-deletion:deleted-before',
          kind: 'sign_in',
          details: {},
          roleAssignment: null,
          roleDeletionSweep: {
            roleId: 'deleted-before',
            previousSlug: 'old-slug',
            actorId: 'staff-before',
            pending: true,
            sweepId: 'sweep-before',
          },
        },
        {
          eventId: 'assignment-before',
          kind: 'sign_in',
          details: {},
          roleAssignment: {
            assignedRoleId: 'assigned-before',
            previousRoleId: 'previous-before',
            sessionVersion: 7,
          },
          roleDeletionSweep: null,
        },
      ]);
      expect(
        (await recorded(pool)).filter((name) => name === ACTIVITY_MIGRATION),
      ).toEqual(['0027_activity_log.sql']);
      expect(await applyPostgresMigrations(pool)).toEqual([]);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );

  it(
    'b18 rolls back columns and the migration ledger when an index creation fails',
    async () => {
      const pool = await emptyDatabase();
      await prepareLegacyActivity(pool);
      const before = await legacyEvidence(pool);
      await pool.query(
        `CREATE INDEX ${ACTIVITY_KIND_INDEX} ON security_events (action)`,
      );

      await expect(applyPostgresMigrations(pool)).rejects.toMatchObject({
        code: '42P07',
      });
      expect(await legacyEvidence(pool)).toEqual(before);
      expect((await recorded(pool)).includes(ACTIVITY_MIGRATION)).toBe(false);
      const columns = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'security_events'
            AND column_name IN ('kind', 'details') ORDER BY column_name`,
      );
      expect(columns.rows).toEqual([]);

      await pool.query(`DROP INDEX ${ACTIVITY_KIND_INDEX}`);
      expect(await applyPostgresMigrations(pool)).toEqual([ACTIVITY_MIGRATION]);
      expect((await recorded(pool)).includes(ACTIVITY_MIGRATION)).toBe(true);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
