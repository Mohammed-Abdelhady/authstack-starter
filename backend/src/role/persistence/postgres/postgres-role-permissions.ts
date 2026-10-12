import { Kysely } from 'kysely';
import { RolePermissions } from '../../stores/role-permissions';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';

export class PostgresRolePermissions extends RolePermissions {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async ofRole(slug: string): Promise<string[] | null> {
    const row = await this.database
      .selectFrom('roles')
      .select('permissions')
      .where('slug', '=', slug)
      .executeTakeFirst();
    return row ? [...row.permissions] : null;
  }
}
