import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { openPostgresDatabase } from '../../../common/persistence/postgres/postgres-database';
import {
  EVERY_MIGRATION,
  useMigrateDatabases,
} from '../../../common/persistence/postgres/postgres-migrate.harness-spec';
import {
  applyPostgresMigrations,
  MIGRATION_LOCK_WAIT_MS,
} from '../../../common/persistence/postgres/postgres-migrations';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { readAccount } from './postgres-account-rows';

const MIGRATION_NAME = '0019_account_locale.sql';
const MIGRATION = join(
  __dirname,
  '../../../common/persistence/postgres/migrations',
  MIGRATION_NAME,
);

interface LocaleColumn {
  column_default: string | null;
  is_nullable: string;
}

async function insertAccount(pool: Pool, email: string): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, role, created_at, updated_at)
     VALUES ($1, 'Stored', 'user', $2, $2) RETURNING id`,
    [email, TEST_NOW],
  );
  const account = row.rows[0];
  if (!account) throw new Error('Account fixture was not inserted');
  return account.id;
}

describe('0019_account_locale.sql', () => {
  const { emptyDatabase } = useMigrateDatabases();

  it('gives an account stored before it the language en, and runs twice', async () => {
    const pool = await emptyDatabase();
    await applyPostgresMigrations(
      pool,
      MIGRATION_LOCK_WAIT_MS,
      EVERY_MIGRATION.filter((name) => name < MIGRATION_NAME),
    );
    const id = await insertAccount(pool, 'before@example.test');
    const migration = readFileSync(MIGRATION, 'utf8');
    await pool.query(migration);
    await pool.query(migration);

    const column = await pool.query<LocaleColumn>(
      `SELECT column_default, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'locale'`,
    );
    const stored = await pool.query<{ locale: string }>(
      'SELECT locale FROM users WHERE id = $1',
      [id],
    );
    expect({ column: column.rows, stored: stored.rows }).toEqual({
      column: [{ column_default: "'en'::text", is_nullable: 'NO' }],
      stored: [{ locale: 'en' }],
    });

    await applyPostgresMigrations(pool, MIGRATION_LOCK_WAIT_MS);
    expect((await readAccount(openPostgresDatabase(pool), id))?.locale).toBe(
      'en',
    );
  });

  it('reads a language this build does not carry as en', async () => {
    const pool = await emptyDatabase();
    await applyPostgresMigrations(pool, MIGRATION_LOCK_WAIT_MS);
    const id = await insertAccount(pool, 'elsewhere@example.test');
    await pool.query("UPDATE users SET locale = 'xx' WHERE id = $1", [id]);

    expect((await readAccount(openPostgresDatabase(pool), id))?.locale).toBe(
      'en',
    );
  });
});
