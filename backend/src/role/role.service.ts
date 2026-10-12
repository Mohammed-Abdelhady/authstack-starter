import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { RoleCatalogStore } from './stores/role-catalog.store';
import { StoredRole } from './stores/role-records';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ListRolesQueryDto } from './dto/list-roles-query.dto';
import {
  RoleResponseDto,
  RoleListData,
  RoleUpdateResponseDto,
} from './dto/role-response.dto';
import { UserRole } from '../user/enums/user-role.enum';
import { WILDCARD_PERMISSION } from '../common/constants/permissions';
import {
  assertValidPermissions,
  generateSlug,
  mapRoleToResponseDto,
} from './utils/role.util';
import { ErrorCode } from '../common/enums/error-code.enum';
import { AppException } from '../common/exceptions/app.exception';
import { RoleEditService } from './services/edit/role-edit.service';

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(
    private readonly catalog: RoleCatalogStore,
    private readonly roleEdit: RoleEditService,
  ) {}

  /**
   * Create a new role with validation
   */
  async create(dto: CreateRoleDto, actorId: string): Promise<RoleResponseDto> {
    const slug = generateSlug(dto.name);

    const existing = await this.catalog.findRoleBySlug(slug);
    if (existing) {
      throw new AppException(
        ErrorCode.ROLE_NAME_TAKEN,
        `Role with name "${dto.name}" already exists`,
        HttpStatus.CONFLICT,
      );
    }

    assertValidPermissions(dto.permissions);

    const role = await this.roleEdit.create(dto, slug, actorId);

    return this.mapToResponseDto(role);
  }

  /**
   * List all roles with pagination and search
   */
  async findAll(query: ListRolesQueryDto): Promise<RoleListData> {
    const { page = 1, limit = 10, search } = query;
    const { roles, total } = await this.catalog.listRoles({
      search,
      page,
      limit,
    });

    const pages = Math.ceil(total / limit);

    return {
      roles: roles.map((role) => this.mapToResponseDto(role)),
      total,
      page,
      pages,
    };
  }

  /**
   * Get a single role by ID or slug
   */
  async findOne(idOrSlug: string): Promise<RoleResponseDto> {
    const role = await this.findRoleByIdOrSlug(idOrSlug);
    return this.mapToResponseDto(role);
  }

  /**
   * Update an existing role.
   * System roles keep their slug. Renaming a custom role moves every user
   * assigned to the old slug onto the new one.
   */
  async update(
    idOrSlug: string,
    dto: UpdateRoleDto,
    actorId: string,
  ): Promise<RoleUpdateResponseDto> {
    const role = await this.findRoleByIdOrSlug(idOrSlug);
    const previousSlug = role.slug;
    const nextSlug = dto.name ? generateSlug(dto.name) : previousSlug;

    if (role.isSystemRole && nextSlug !== previousSlug) {
      throw new AppException(
        ErrorCode.SYSTEM_ROLE_RENAME_FORBIDDEN,
        `System role "${previousSlug}" cannot be renamed to a different slug`,
        HttpStatus.FORBIDDEN,
      );
    }

    if (dto.permissions) {
      assertValidPermissions(dto.permissions);
      this.assertAdminKeepsWildcard(previousSlug, dto.permissions);
    }

    if (dto.name && nextSlug !== previousSlug) {
      await this.assertSlugAvailable(nextSlug, role);
    }

    // The previous slug and the rename flag are recomputed inside the work
    // function, so a rename that landed meanwhile is used, not the stale one.
    const outcome = await this.roleEdit.commit(role.id, dto, actorId);

    // The rename line is written only after the transaction commits, so an
    // aborted attempt cannot report a rename that never landed.
    if (outcome.renamed) {
      this.logger.log(
        `Role renamed from "${outcome.previousSlug}" to "${outcome.nextSlug}", ${outcome.usersMoved} user(s) moved`,
      );
    }

    return {
      ...this.mapToResponseDto(outcome.role),
      usersMoved: outcome.usersMoved,
    };
  }

  /**
   * Delete a role with validation
   */
  async delete(idOrSlug: string, actorId: string): Promise<void> {
    const role = await this.findRoleByIdOrSlug(idOrSlug);

    // System and protected roles are permanent
    if (role.isSystemRole || role.isProtected) {
      throw new AppException(
        ErrorCode.ROLE_PROTECTED,
        `Role "${role.slug}" is protected and cannot be deleted`,
        HttpStatus.FORBIDDEN,
      );
    }

    await this.roleEdit.delete(role.id, actorId);
  }

  /**
   * Get role by slug (helper method)
   */
  async getRoleBySlug(slug: string): Promise<StoredRole | null> {
    return this.catalog.findRoleBySlug(slug);
  }

  /**
   * Check if role is assigned to any users
   */
  async isRoleAssignedToUsers(roleSlug: string): Promise<boolean> {
    const count = await this.catalog.countHolders(roleSlug);
    return count > 0;
  }

  /**
   * Get user count for a role
   */
  async getUserCount(roleSlug: string): Promise<number> {
    return this.catalog.countHolders(roleSlug);
  }

  /**
   * Find role by ID or slug (private helper)
   */
  private async findRoleByIdOrSlug(idOrSlug: string): Promise<StoredRole> {
    const role = await this.catalog.findRole(idOrSlug);

    if (!role) {
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        `Role "${idOrSlug}" not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return role;
  }

  /**
   * Reject a slug already taken by another role
   */
  private async assertSlugAvailable(
    slug: string,
    role: StoredRole,
  ): Promise<void> {
    const existing = await this.catalog.findRoleBySlug(slug);

    if (existing && existing.id !== role.id) {
      throw new AppException(
        ErrorCode.ROLE_NAME_TAKEN,
        `Role with slug "${slug}" already exists`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /**
   * The admin role keeps the wildcard permission, otherwise the last
   * account able to manage the system loses its access
   */
  private assertAdminKeepsWildcard(slug: string, permissions: string[]): void {
    if (slug !== (UserRole.ADMIN as string)) {
      return;
    }

    if (!permissions.includes(WILDCARD_PERMISSION)) {
      throw new AppException(
        ErrorCode.ADMIN_WILDCARD_REQUIRED,
        `The "${WILDCARD_PERMISSION}" permission cannot be removed from the admin role`,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Map a stored role to its response DTO
   */
  private mapToResponseDto(role: StoredRole): RoleResponseDto {
    return mapRoleToResponseDto(role);
  }
}
