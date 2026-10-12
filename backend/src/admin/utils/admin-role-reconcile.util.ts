import { HttpStatus, Logger } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { describeStoreFailure } from '../../common/persistence/store-failure';
import {
  RoleSweepStores,
  sweepRoleHolders,
} from '../../role/sweeps/role-holder-sweep';
import { StoredAccount } from '../../user/stores/stored-account';
import { ADMIN_ROLE_RECONCILE_FAILED } from '../constants/admin-user.constants';
import { AdminAccountStore } from '../stores/admin-account.store';
import { AssignedRoleRef } from '../types/assigned-role-ref';

/** Resolve the assigned role by id after commit and repair or undo the assignment. */
export async function reconcileAssignedRole(input: {
  accounts: AdminAccountStore;
  roles: RoleSweepStores;
  logger: Logger;
  actorId: string;
  userId: string;
  ref: AssignedRoleRef;
}): Promise<string> {
  const { accounts, roles, logger, actorId, userId, ref } = input;
  const sweep = { actorId, logger, userId, roleId: ref.roleId };
  let missing = false;
  let current: StoredAccount | null;
  try {
    const role = await accounts.findRole(ref.roleId);
    if (role) {
      if (role.slug !== ref.assignedSlug) {
        await sweepRoleHolders(roles, {
          ...sweep,
          previousSlug: ref.assignedSlug,
        });
      }
    } else if (ref.created) {
      const created = ref.created;
      current = await roles.runner.run(async (unitOfWork) => {
        await accounts.removeCreatedAccount(unitOfWork, {
          id: userId,
          role: ref.assignedSlug,
          updatedAt: created.updatedAt,
          sessionVersion: created.sessionVersion,
        });
        return accounts.readAccount(unitOfWork, userId);
      });
      missing = !current;
      if (current && !(await accounts.findRoleBySlug(current.role))) {
        await sweepRoleHolders(roles, {
          ...sweep,
          previousSlug: current.role,
        });
      }
    } else {
      await sweepRoleHolders(roles, {
        ...sweep,
        previousSlug: ref.assignedSlug,
        previousRoleId: ref.previousRoleId,
      });
      missing = true;
    }
    current = await accounts.findAccount(userId);
    if (!ref.created && role && current && current.role !== role.slug) {
      missing = !(await accounts.findRole(ref.roleId));
    }
  } catch (error) {
    logger.error({
      event: ADMIN_ROLE_RECONCILE_FAILED,
      userId,
      roleId: ref.roleId,
      error: describeStoreFailure(error),
    });
    throw error;
  }
  if (missing || !current) {
    throw new AppException(
      ErrorCode.ROLE_NOT_FOUND,
      `Role "${ref.assignedSlug}" does not exist`,
      HttpStatus.NOT_FOUND,
    );
  }
  return current.role;
}
