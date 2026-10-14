import { HttpStatus } from '@nestjs/common';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { WILDCARD_PERMISSION } from '../../common/constants/permissions';
import { hasPermission } from '../../common/utils/permission.utils';
import {
  canModifyLevel,
  isAdminRole,
  LevelActor,
} from '../../common/utils/role-hierarchy';
import { RoleChangeStore } from '../stores/role-change.store';
import { RoleLevelSource, resolveRoleLevel } from './role.util';

/** What the acting account holds, read inside the caller's unit of work. */
export interface FreshRoleActor extends LevelActor {
  permissions: string[];
}

export async function assertFreshRolePermission(
  store: RoleChangeStore,
  unitOfWork: UnitOfWork,
  actorId: string,
  permission: string,
): Promise<FreshRoleActor> {
  const actor = await store.readActor(unitOfWork, actorId);
  if (!actor || actor.isDeleted) {
    throw new AppException(
      ErrorCode.SESSION_INVALID,
      'Actor is no longer active',
      HttpStatus.UNAUTHORIZED,
    );
  }
  const role = await store.readRoleAuthorityBySlug(unitOfWork, actor.roleSlug);
  if (!role) {
    throw new AppException(
      ErrorCode.SESSION_INVALID,
      'Actor role is no longer active',
      HttpStatus.UNAUTHORIZED,
    );
  }
  const permissions = [...role.permissions, ...actor.permissions];
  if (!hasPermission(permissions, permission)) {
    throw new AppException(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      'Actor can no longer manage roles',
      HttpStatus.FORBIDDEN,
    );
  }
  return {
    level: resolveRoleLevel(role),
    isAdmin: isAdminRole(actor.roleSlug),
    permissions,
  };
}

/**
 * An actor hands out only what it holds. The wildcard is held by a wildcard
 * holder alone, and a wildcard holder holds everything else.
 *
 * @throws AppException FORBIDDEN on the first permission the actor lacks
 */
export function assertCanGrant(
  actor: FreshRoleActor,
  permissions: string[],
): void {
  for (const permission of permissions) {
    if (!hasPermission(actor.permissions, permission)) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        `Cannot grant "${permission}" without holding it`,
        HttpStatus.FORBIDDEN,
      );
    }
  }
}

/**
 * A role's level stays below the actor's own, for wildcard holders as well.
 * Pass the level the role will hold, a default included.
 *
 * @throws AppException CANNOT_MODIFY_HIGHER_ROLE
 */
export function assertLevelBelowActor(
  actor: FreshRoleActor,
  level: number,
): void {
  if (level < actor.level) return;
  throw new AppException(
    ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    'Cannot give a role a level at or above your own',
    HttpStatus.FORBIDDEN,
  );
}

/**
 * The level an edit stores, or undefined when it leaves the level alone.
 * A system role keeps its seeded level, so the admin role cannot be lowered
 * under the level admin-only actions need.
 *
 * @throws AppException ROLE_PROTECTED for a system role
 * @throws AppException CANNOT_MODIFY_HIGHER_ROLE at or above the actor
 */
export function levelEdit(
  actor: FreshRoleActor,
  role: RoleLevelSource & { isSystemRole: boolean },
  level: number | undefined,
): number | undefined {
  if (level === undefined || level === resolveRoleLevel(role)) return;
  if (role.isSystemRole) {
    throw new AppException(
      ErrorCode.ROLE_PROTECTED,
      'The level of a system role cannot change',
      HttpStatus.FORBIDDEN,
    );
  }
  assertLevelBelowActor(actor, level);
  return level;
}

/**
 * A wildcard holder may edit all roles. Other actors must outrank the role.
 *
 * @throws AppException CANNOT_MODIFY_HIGHER_ROLE
 */
export function assertOutranksRole(
  actor: FreshRoleActor,
  role: RoleLevelSource,
): void {
  if (actor.permissions.includes(WILDCARD_PERMISSION)) return;
  if (!canModifyLevel(actor, resolveRoleLevel(role))) {
    throw new AppException(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      'Cannot edit a role at or above your own level',
      HttpStatus.FORBIDDEN,
    );
  }
}
