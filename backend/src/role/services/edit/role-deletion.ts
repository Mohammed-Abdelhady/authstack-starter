import { randomUUID } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import type { StaffMutationRules } from '../../../admin/services/staff-mutations/staff-mutation-rules';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { ROLE_PERMISSIONS } from '../../../common/constants/permissions';
import { ROLE_PENDING_SWEEP_LIMIT } from '../../../common/constants/roles';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { UserRole } from '../../../user/enums/user-role.enum';
import type { RoleChangeStore } from '../../stores/role-change.store';
import type { PendingSweep } from '../../stores/role-records';
import {
  assertFreshRolePermission,
  assertOutranksRole,
} from '../../utils/role-actor.util';

/** The session and the version a role edit or deletion was sent with. */
export interface RoleMutation {
  session?: ActingSession;
  version?: number;
}

export interface RoleDeletionRequest {
  roleId: string;
  actorId: string;
  mutation: RoleMutation;
}

/** The sweeps the deletion owes, and the role that now holds them. */
export interface RoleDeletionRepair {
  ownerId: string;
  refs: PendingSweep[];
  recorded: boolean;
}

/**
 * Remove a role nobody holds, and record the deletion its stranded-account
 * repair reads, in the caller's unit of work.
 */
export async function deleteRoleInWork(
  services: { changes: RoleChangeStore; rules: StaffMutationRules },
  unitOfWork: UnitOfWork,
  request: RoleDeletionRequest,
): Promise<RoleDeletionRepair> {
  const { changes, rules } = services;
  const { roleId, actorId, mutation } = request;
  await rules.policy.assertRouteProof(unitOfWork, mutation.session);
  const actor = await assertFreshRolePermission(
    changes,
    unitOfWork,
    actorId,
    ROLE_PERMISSIONS.DELETE_ALL,
  );
  const current = await changes.takeRoleForChange(unitOfWork, roleId);
  if (!current) {
    throw new AppException(
      ErrorCode.ROLE_NOT_FOUND,
      'Role no longer exists',
      HttpStatus.NOT_FOUND,
    );
  }
  if (current.isSystemRole || current.isProtected) {
    throw new AppException(
      ErrorCode.ROLE_PROTECTED,
      'Role is protected',
      HttpStatus.FORBIDDEN,
    );
  }
  rules.policy.assertVersion(mutation.version, current.version);
  assertOutranksRole(actor, current);
  const count = await changes.countHoldersInWork(unitOfWork, current.slug);
  if (count > 0) {
    throw new AppException(
      ErrorCode.ROLE_HAS_USERS,
      'Reassign role holders before deleting',
      HttpStatus.BAD_REQUEST,
      { count },
    );
  }
  const fallback = await changes.readRoleBySlug(unitOfWork, UserRole.USER);
  if (!fallback) {
    throw new AppException(
      ErrorCode.ROLE_NOT_FOUND,
      'Default role does not exist',
      HttpStatus.NOT_FOUND,
    );
  }
  const ref = {
    roleId: current.id,
    previousSlug: current.slug,
    actorId,
    sweepId: randomUUID(),
  };
  const transferred = current.pendingHolderSweeps ?? [];
  const recorded = transferred.length > 0;
  if (recorded) {
    const refs = [...(fallback.pendingHolderSweeps ?? []), ref, ...transferred];
    if (refs.length > ROLE_PENDING_SWEEP_LIMIT) {
      throw new AppException(
        ErrorCode.AUTHORITY_UNAVAILABLE,
        'Pending role repairs must finish before deleting',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await changes.savePendingSweeps(unitOfWork, fallback.id, refs);
  }
  await changes.appendRoleDeletion(unitOfWork, ref);
  await changes.removeRole(unitOfWork, current.id);
  return { ownerId: fallback.id, refs: [ref, ...transferred], recorded };
}
