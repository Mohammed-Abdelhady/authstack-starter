import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { PERMISSION_REGEX } from '../../common/constants/permissions';
import {
  CUSTOM_ROLE_LEVEL,
  ROLE_HIERARCHY,
} from '../../common/utils/role-hierarchy';
import { RoleResponseDto } from '../dto/role-response.dto';
import { StoredRole } from '../stores/role-records';

/**
 * Role fields needed to work out a hierarchy level.
 */
export interface RoleLevelSource {
  slug: string;
  level?: number;
}

/**
 * Turn a role display name into a URL-safe slug.
 *
 * @param name - Role display name
 * @returns Lowercase hyphenated slug
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Reject permissions that do not match resource:action[:scope] or the wildcard.
 *
 * @param permissions - Permission strings to check
 * @throws AppException INVALID_PERMISSION_FORMAT on the first malformed entry
 */
export function assertValidPermissions(permissions: string[]): void {
  for (const permission of permissions) {
    if (!PERMISSION_REGEX.test(permission)) {
      throw new AppException(
        ErrorCode.INVALID_PERMISSION_FORMAT,
        `Invalid permission format: "${permission}". Must be resource:action[:scope] or wildcard "*"`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

/**
 * Compare two permission lists as sets: equal size and membership both ways.
 * Duplicates are ignored, so `[a, b]` and `[a, a]` differ (b is dropped).
 *
 * @param current - Permissions stored on the role
 * @param next - Permissions in the update
 */
export function samePermissions(current: string[], next: string[]): boolean {
  const stored = new Set(current);
  const incoming = new Set(next);
  if (stored.size !== incoming.size) {
    return false;
  }
  for (const permission of stored) {
    if (!incoming.has(permission)) {
      return false;
    }
  }
  return true;
}

/**
 * Drop duplicate permission entries before they are stored, so the stored
 * permission set is canonical.
 *
 * @param permissions - Permissions from the request
 */
export function dedupePermissions(permissions: string[]): string[] {
  return [...new Set(permissions)];
}

/**
 * Hierarchy level of a role document.
 * Falls back to the seed map for documents written before the level field,
 * then to the level shared by custom roles.
 *
 * @param role - Role slug and stored level
 */
export function resolveRoleLevel(role: RoleLevelSource): number {
  return role.level ?? ROLE_HIERARCHY[role.slug] ?? CUSTOM_ROLE_LEVEL;
}

/**
 * Map a stored role to its response DTO.
 *
 * @param role - Stored role
 * @returns Serialized role response DTO
 */
export function mapRoleToResponseDto(role: StoredRole): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description,
    isSystemRole: role.isSystemRole,
    isProtected: role.isProtected,
    level: resolveRoleLevel(role),
    permissions: role.permissions,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
