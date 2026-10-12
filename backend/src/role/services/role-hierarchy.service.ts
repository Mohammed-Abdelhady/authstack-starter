import { HttpStatus, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RoleCatalogStore } from '../stores/role-catalog.store';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { UNKNOWN_ROLE_LEVEL } from '../../common/utils/role-hierarchy';
import { RoleLevelSource, resolveRoleLevel } from '../utils/role.util';

type RoleLevelProjection = RoleLevelSource;

/**
 * Reads role hierarchy levels from the stored roles.
 * The hardcoded map in common/utils/role-hierarchy only seeds the system roles
 * and serves as a fallback for roles written before the level field existed.
 */
@Injectable()
export class RoleHierarchyService {
  constructor(private readonly catalog: RoleCatalogStore) {}

  /**
   * Level of a role slug.
   *
   * @param slug - Role slug to resolve
   * @returns The stored level, or 0 when the slug has no role
   */
  async getLevel(slug: string, unitOfWork?: UnitOfWork): Promise<number> {
    const role = await this.findLevel(slug, unitOfWork);
    return role ? resolveRoleLevel(role) : UNKNOWN_ROLE_LEVEL;
  }

  /**
   * Level of a role slug that must exist.
   *
   * @param slug - Role slug to resolve
   * @throws AppException ROLE_NOT_FOUND when no role carries the slug
   */
  async getLevelOrFail(slug: string): Promise<number> {
    const role = await this.findLevel(slug);

    if (!role) {
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        `Role "${slug}" does not exist`,
        HttpStatus.NOT_FOUND,
      );
    }

    return resolveRoleLevel(role);
  }

  /**
   * Slugs of every role whose level is at or below the given level.
   * Filtering happens in memory because older roles have no level field.
   *
   * @param level - Inclusive upper bound
   */
  async getSlugsAtOrBelow(level: number): Promise<string[]> {
    const roles = await this.catalog.listRoleLevels();

    return roles
      .filter((role) => resolveRoleLevel(role) <= level)
      .map((role) => role.slug);
  }

  private findLevel(
    slug: string,
    unitOfWork?: UnitOfWork,
  ): Promise<RoleLevelProjection | null> {
    return unitOfWork
      ? this.catalog.readRoleLevelInWork(unitOfWork, slug)
      : this.catalog.readRoleLevel(slug);
  }
}
