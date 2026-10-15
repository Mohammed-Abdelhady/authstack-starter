import { HttpStatus, Logger } from '@nestjs/common';
import { AdminEmailChangeService } from '../services/users/admin-email-change.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  isStoreOutage,
  storeFailureCause,
} from '../../common/persistence/store-failure';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import { asAuthorityUnavailable } from '../../session/utils/authority/authority-unavailable';
import { StoredAccount } from '../../user/stores/stored-account';
import { AdminUserAccessService } from '../services/users/admin-user-access.service';
import { AdminAccountStore } from '../stores/admin-account.store';

/**
 * Only a genuine database failure is an authority failure; a domain refusal
 * (AppException), a validation error or a programming error keeps its own
 * answer. Either way the failure leaves named by what the database raised.
 */
export function rethrowOrUnavailable(error: unknown): never {
  if (!isStoreOutage(error)) {
    throw storeFailureCause(error);
  }
  asAuthorityUnavailable(storeFailureCause(error));
}

/**
 * Write the same session-revocation line the SessionService writes when it
 * owns the unit of work, now that a caller inside one logs after commit.
 */
export function logSessionRevocation(
  logger: Logger,
  userId: string,
  count: number,
): void {
  logger.log(
    `All sessions invalidated for user ${userId}: ${count} document(s)`,
  );
}

/**
 * Re-read the target and the acting account inside the caller's unit of work
 * and repeat the write check against the roles they hold now, so a promotion
 * of the target or a demotion of the actor that lands after the pre-check
 * cannot be acted on. A deactivated target is reported as missing unless the
 * caller is the one bringing it back.
 */
export async function loadAuthorizedUser(
  accounts: AdminAccountStore,
  accessService: AdminUserAccessService,
  unitOfWork: UnitOfWork,
  targetId: string,
  actorId: string,
  message?: string,
  options: { includeDeleted?: boolean; requireAdmin?: boolean } = {},
): Promise<StoredAccount> {
  const current = await accounts.takeAccountForChange(unitOfWork, targetId);
  if (!current || (current.isDeleted && !options.includeDeleted)) {
    throw new AppException(
      ErrorCode.USER_NOT_FOUND,
      'User not found',
      HttpStatus.NOT_FOUND,
    );
  }
  await accessService.assertFreshActorCanModify(
    actorId,
    current.role,
    unitOfWork,
    message,
    options.requireAdmin,
  );
  return current;
}

/**
 * Write an admin name or pending address onto the target as it is now, after
 * the actor's rank is checked again. The next email generation is allocated
 * under the account write, before a confirmation code is issued.
 */
export function saveUserUpdate(
  runner: UnitOfWorkRunner,
  accounts: AdminAccountStore,
  accessService: AdminUserAccessService,
  edit: {
    id: string;
    actorId: string;
    name?: string;
    pendingEmail?: string;
    previousEmail: string;
    previousGeneration: number;
  },
  emailChange: AdminEmailChangeService,
): Promise<StoredAccount> {
  return runner.run(async (unitOfWork) => {
    const current = await loadAuthorizedUser(
      accounts,
      accessService,
      unitOfWork,
      edit.id,
      edit.actorId,
      undefined,
      { requireAdmin: edit.pendingEmail !== undefined },
    );
    if (
      edit.pendingEmail !== undefined &&
      (current.email !== edit.previousEmail ||
        current.addressGeneration !== edit.previousGeneration)
    ) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'The email address changed while this edit was prepared',
        HttpStatus.CONFLICT,
      );
    }
    if (edit.pendingEmail !== undefined) {
      await emailChange.claimPendingIn(unitOfWork, current, edit.pendingEmail);
    }
    return accounts.saveIdentity(unitOfWork, current, {
      name: edit.name,
      address:
        edit.pendingEmail === undefined
          ? undefined
          : {
              email: edit.pendingEmail,
              addressGeneration: current.addressGeneration + 1,
            },
    });
  });
}
