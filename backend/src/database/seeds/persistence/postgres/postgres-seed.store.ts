import { Kysely, sql } from 'kysely';
import {
  assertResetAllowed,
  NewSeedAccount,
  ROLE_SEED,
  RoleSeedOutcome,
  SeedRole,
  SeedStore,
} from '../../seed.store';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { storedAddress } from '../../../../auth/persistence/postgres/postgres-pending-codes-database';

/** Where the adapter records the migrations it applied. Never emptied. */
const MIGRATION_RECORD = 'schema_migrations';

export class PostgresSeedStore extends SeedStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  async seedRole(role: SeedRole): Promise<RoleSeedOutcome> {
    const now = this.clock.now();
    const existing = await this.database
      .selectFrom('roles')
      .select('id')
      .where('slug', '=', role.slug)
      .executeTakeFirst();

    if (!existing) {
      await this.database
        .insertInto('roles')
        .values({
          name: role.name,
          slug: role.slug,
          description: role.description,
          is_system_role: role.isSystemRole,
          is_protected: role.isProtected,
          level: role.level,
          permissions: role.permissions,
          created_at: now,
          updated_at: now,
        })
        .execute();
      return ROLE_SEED.CREATED;
    }

    await this.database
      .updateTable('roles')
      .set({
        is_system_role: role.isSystemRole,
        is_protected: role.isProtected,
        level: role.level,
        updated_at: now,
      })
      .where('slug', '=', role.slug)
      .execute();
    return ROLE_SEED.REFRESHED;
  }

  async replaceRolePermissions(
    slug: string,
    permissions: string[],
  ): Promise<void> {
    await this.database
      .updateTable('roles')
      .set({ permissions, updated_at: this.clock.now() })
      .where('slug', '=', slug)
      .execute();
  }

  async findAccountId(email: string): Promise<string | null> {
    const row = await this.database
      .selectFrom('users')
      .select('id')
      .where('email', '=', storedAddress(email))
      .executeTakeFirst();
    return row ? row.id : null;
  }

  async createAccount(account: NewSeedAccount): Promise<string> {
    const now = this.clock.now();
    const row = await this.database
      .insertInto('users')
      .values({
        email: storedAddress(account.email),
        name: account.name.trim(),
        role: account.role,
        permissions: account.permissions,
        password_hash: account.passwordHash,
        is_verified: true,
        auth_provider: 'email',
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /**
   * One statement over every table of this schema but the migration record, so
   * the foreign keys are checked once, after all the rows are gone.
   */
  async clearApplicationData(): Promise<void> {
    assertResetAllowed();
    const found = await sql<{ tablename: string }>`
      SELECT tablename
        FROM pg_tables
       WHERE schemaname = current_schema()
         AND tablename <> ${MIGRATION_RECORD}
       ORDER BY tablename`.execute(this.database);
    const [first, ...others] = found.rows.map(({ tablename }) => tablename);
    if (first === undefined) {
      return;
    }
    const emptyOthers = others.map(
      (table, index) =>
        sql`${sql.ref(`emptied_${index}`)} AS (DELETE FROM ${sql.table(table)})`,
    );
    const statement =
      emptyOthers.length === 0
        ? sql`DELETE FROM ${sql.table(first)}`
        : sql`WITH ${sql.join(emptyOthers)} DELETE FROM ${sql.table(first)}`;
    await statement.execute(this.database);
  }
}
