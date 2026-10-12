import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { ROLE_PERMISSIONS } from '../../common/constants/permissions';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { CUSTOM_ROLE_LEVEL } from '../../common/utils/role-hierarchy';
import { asAuthorityUnavailable } from '../../session/utils/authority/authority-unavailable';
import { CreateRoleDto } from '../dto/create-role.dto';
import { RoleChangeStore } from '../stores/role-change.store';
import { RoleFieldsRejectedError, StoredRole } from '../stores/role-records';
import { assertCanGrant, assertFreshRolePermission } from './role-actor.util';
import { isStoreOutage } from './role-failure.util';
import { dedupePermissions } from './role.util';

interface RoleCreation {
  runner: UnitOfWorkRunner;
  store: RoleChangeStore;
}

/**
 * Store a new custom role. The actor is read inside the unit of work, so a
 * permission it lost after the request was admitted cannot be handed out.
 */
export function createRoleWithinCeiling(
  { runner, store }: RoleCreation,
  dto: CreateRoleDto,
  slug: string,
  actorId: string,
): Promise<StoredRole> {
  return runner.runForAuthority(actorId, async (unitOfWork) => {
    const actor = await assertFreshRolePermission(
      store,
      unitOfWork,
      actorId,
      ROLE_PERMISSIONS.CREATE_ALL,
    );
    assertCanGrant(actor, dto.permissions);
    return store.insertCustomRole(unitOfWork, {
      name: dto.name,
      slug,
      description: dto.description,
      level: CUSTOM_ROLE_LEVEL,
      permissions: dedupePermissions(dto.permissions),
    });
  });
}

/** Turn a failed role write into the answer the role routes give for it. */
export function rethrowRoleWriteError(
  error: unknown,
  requestedSlug?: string,
): never {
  if (error instanceof UniqueConflictError) {
    throw new AppException(
      ErrorCode.ROLE_NAME_TAKEN,
      `Role with slug "${requestedSlug ?? 'requested'}" already exists`,
      HttpStatus.CONFLICT,
    );
  }
  if (error instanceof RoleFieldsRejectedError) {
    throw new AppException(
      ErrorCode.VALIDATION_ERROR,
      error.message,
      HttpStatus.BAD_REQUEST,
    );
  }
  if (!isStoreOutage(error)) {
    throw error;
  }
  asAuthorityUnavailable(error);
}
