import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RoleLevelSource } from '../utils/role.util';
import { RoleListPage, RoleListQuery, StoredRole } from './role-records';

/**
 * Role reads that change nothing. Every method but the last reads committed
 * state on its own, outside any unit of work.
 */
export abstract class RoleCatalogStore {
  /** By id when the text is an id of this database, by slug otherwise. */
  abstract findRole(idOrSlug: string): Promise<StoredRole | null>;
  abstract findRoleBySlug(slug: string): Promise<StoredRole | null>;
  /** Newest first. The search matches name or slug, ignoring case. */
  abstract listRoles(query: RoleListQuery): Promise<RoleListPage>;
  abstract countHolders(slug: string): Promise<number>;
  abstract readRoleLevel(slug: string): Promise<RoleLevelSource | null>;
  abstract listRoleLevels(): Promise<RoleLevelSource[]>;
  /** The same level read, inside the caller's unit of work. */
  abstract readRoleLevelInWork(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<RoleLevelSource | null>;
}
