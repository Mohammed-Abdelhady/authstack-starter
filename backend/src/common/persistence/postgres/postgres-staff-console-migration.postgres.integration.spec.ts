import {
  applyPostgresMigrations,
  MIGRATION_LOCK_WAIT_MS,
} from './postgres-migrations';
import {
  EVERY_MIGRATION,
  MIGRATE_CASE_TIMEOUT_MS,
  useMigrateDatabases,
} from './postgres-migrate.harness-spec';

const STAFF_MIGRATION = '0028_staff_console.sql';
const UPDATE_ALL = 'users:update:all';
const UPDATE_STAFF = 'users:update:staff';
const READ_ALL = 'users:read:all';
const SUSPEND_ALL = 'users:suspend:all';
const SUSPEND_STAFF = 'users:suspend:staff';

interface GrantRow {
  label: string;
  permissions: string[];
}

describe('staff console suspend permission backfill', () => {
  const { emptyDatabase } = useMigrateDatabases();

  it(
    'preserves suspension authority without granting it to readers',
    async () => {
      const pool = await emptyDatabase();
      await applyPostgresMigrations(
        pool,
        MIGRATION_LOCK_WAIT_MS,
        EVERY_MIGRATION.filter((name) => name < STAFF_MIGRATION),
      );
      const original = [
        { label: 'all', permissions: [UPDATE_ALL] },
        { label: 'staff', permissions: [UPDATE_STAFF] },
        { label: 'reader', permissions: [READ_ALL] },
        { label: 'existing', permissions: [UPDATE_ALL, SUSPEND_ALL] },
      ];
      for (const { label, permissions } of original) {
        await pool.query(
          'INSERT INTO roles (name, slug, permissions, created_at, updated_at) VALUES ($1, $1, $2, now(), now())',
          [label, permissions],
        );
        await pool.query(
          'INSERT INTO users (name, permissions) VALUES ($1, $2)',
          [label, permissions],
        );
      }
      await applyPostgresMigrations(
        pool,
        MIGRATION_LOCK_WAIT_MS,
        EVERY_MIGRATION,
      );
      const expected = [
        { label: 'all', permissions: [UPDATE_ALL, SUSPEND_ALL] },
        { label: 'existing', permissions: [UPDATE_ALL, SUSPEND_ALL] },
        { label: 'reader', permissions: [READ_ALL] },
        { label: 'staff', permissions: [UPDATE_STAFF, SUSPEND_STAFF] },
      ];
      const roles = await pool.query<GrantRow>(
        'SELECT slug AS label, permissions FROM roles ORDER BY slug',
      );
      const users = await pool.query<GrantRow>(
        'SELECT name AS label, permissions FROM users ORDER BY name',
      );
      expect(roles.rows).toEqual(expected);
      expect(users.rows).toEqual(expected);
    },
    MIGRATE_CASE_TIMEOUT_MS,
  );
});
