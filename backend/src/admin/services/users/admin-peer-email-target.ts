import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import type { StoredAccount } from '../../../user/stores/stored-account';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import type { AdminUserAccessService } from './admin-user-access.service';

/** The target and the acting administrator, both read again under the roster lock. */
export async function loadPeerTarget(
  services: { accounts: AdminAccountStore; access: AdminUserAccessService },
  work: UnitOfWork,
  update: { id: string; actorId: string },
): Promise<StoredAccount> {
  const { accounts, access } = services;
  const current = await accounts.takeAccountForChange(work, update.id);
  if (!current || current.isDeleted) {
    throw new AppException(
      ErrorCode.USER_NOT_FOUND,
      'User not found',
      HttpStatus.NOT_FOUND,
    );
  }
  const actor = await accounts.readAccount(work, update.actorId);
  if (!actor || actor.isDeleted) {
    throw new AppException(
      ErrorCode.SESSION_INVALID,
      'Actor is no longer active',
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (!isAdminRole(current.role) || !isAdminRole(actor.role)) {
    throw peerRefusal();
  }
  await access.assertTargetScopeInWork(
    work,
    actor.id,
    current.audience,
    USER_SCOPE_ACTION.UPDATE,
  );
  return current;
}

export function peerRefusal(): AppException {
  return new AppException(
    ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    'Cannot modify user with higher or equal role',
    HttpStatus.FORBIDDEN,
  );
}
