import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { readAccount } from './postgres-account-rows';

const MIGRATION = join(
  __dirname,
  '../../../common/persistence/postgres/migrations/0019_account_locale.sql',
);

interface LocaleColumn {
  column_default: string | null;
  is_nullable: string;
}

describe('0019_account_locale.sql', () => {
  let connection: TestConnection;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await connection.reset();
  });

  async function insertAccount(email: string): Promise<string> {
    const row = await sql<{ id: string }>`
      INSERT INTO users (email, name, role, created_at, updated_at)
      VALUES (${email}, 'Stored', 'user', ${TEST_NOW}, ${TEST_NOW})
      RETURNING id`.execute(connection.database);
    return row.rows[0].id;
  }

  it('gives an account stored before it the language en, and runs twice', async () => {
    const { pool } = connection;
    await pool.query('ALTER TABLE users DROP COLUMN locale');
    const id = await insertAccount('before@example.test');

    const migration = readFileSync(MIGRATION, 'utf8');
    await pool.query(migration);
    await pool.query(migration);

    const column = await pool.query<LocaleColumn>(
      `SELECT column_default, is_nullable
         FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'locale'`,
    );
    expect({
      column: column.rows,
      read: (await readAccount(connection.database, id))?.locale,
    }).toEqual({
      column: [{ column_default: "'en'::text", is_nullable: 'NO' }],
      read: 'en',
    });
  });

  it('reads a language this build does not carry as en', async () => {
    const id = await insertAccount('elsewhere@example.test');
    await connection.pool.query(
      "UPDATE users SET locale = 'xx' WHERE email = 'elsewhere@example.test'",
    );

    expect((await readAccount(connection.database, id))?.locale).toBe('en');
  });
});
