import { Kysely } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RoleCatalogStore } from '../../stores/role-catalog.store';
import {
  RoleListPage,
  RoleListQuery,
  StoredRole,
} from '../../stores/role-records';
import { RoleLevelSource } from '../../utils/role.util';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import {
  containsPattern,
  isUuidText,
  ROLE_COLUMNS,
  RoleReader,
  toStoredRoleOrNull,
  toStoredRoles,
} from './postgres-role-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

interface LevelRow {
  slug: string;
  level: number | null;
}

function toLevelSource(row: LevelRow): RoleLevelSource {
  return { slug: row.slug, level: row.level ?? undefined };
}

async function readLevel(
  reader: RoleReader,
  slug: string,
): Promise<RoleLevelSource | null> {
  const row = await reader
    .selectFrom('roles')
    .select(['slug', 'level'])
    .where('slug', '=', slug)
    .executeTakeFirst();
  return row ? toLevelSource(row) : null;
}

export class PostgresRoleCatalogStore extends RoleCatalogStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async findRole(idOrSlug: string): Promise<StoredRole | null> {
    if (!isUuidText(idOrSlug)) {
      return this.findRoleBySlug(idOrSlug);
    }
    const row = await this.database
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('id', '=', idOrSlug.toLowerCase())
      .executeTakeFirst();
    return toStoredRoleOrNull(this.database, row);
  }

  async findRoleBySlug(slug: string): Promise<StoredRole | null> {
    const row = await this.database
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('slug', '=', slug)
      .executeTakeFirst();
    return toStoredRoleOrNull(this.database, row);
  }

  async listRoles(query: RoleListQuery): Promise<RoleListPage> {
    const pattern = query.search ? containsPattern(query.search) : undefined;
    let page = this.database.selectFrom('roles').select(ROLE_COLUMNS);
    let count = this.database
      .selectFrom('roles')
      .select((role) => role.fn.countAll<string>().as('total'));
    if (pattern !== undefined) {
      page = page.where((role) =>
        role.or([
          role('name', 'ilike', pattern),
          role('slug', 'ilike', pattern),
        ]),
      );
      count = count.where((role) =>
        role.or([
          role('name', 'ilike', pattern),
          role('slug', 'ilike', pattern),
        ]),
      );
    }
    const [rows, counted] = await Promise.all([
      page
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .offset((query.page - 1) * query.limit)
        .limit(query.limit)
        .execute(),
      count.executeTakeFirstOrThrow(),
    ]);
    return {
      roles: await toStoredRoles(this.database, rows),
      total: Number.parseInt(counted.total, 10),
    };
  }

  async countHolders(slug: string): Promise<number> {
    const counted = await this.database
      .selectFrom('users')
      .select((user) => user.fn.countAll<string>().as('total'))
      .where('role', '=', slug)
      .executeTakeFirstOrThrow();
    return Number.parseInt(counted.total, 10);
  }

  readRoleLevel(slug: string): Promise<RoleLevelSource | null> {
    return readLevel(this.database, slug);
  }

  async listRoleLevels(): Promise<RoleLevelSource[]> {
    const rows = await this.database
      .selectFrom('roles')
      .select(['slug', 'level'])
      .execute();
    return rows.map(toLevelSource);
  }

  readRoleLevelInWork(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<RoleLevelSource | null> {
    return readLevel(postgresTransactionOf(unitOfWork), slug);
  }
}
