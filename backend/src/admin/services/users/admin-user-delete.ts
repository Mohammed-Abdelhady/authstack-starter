import { HttpStatus, type Logger } from '@nestjs/common';
import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import type { AccountSessions } from '../../../user/stores/account-sessions';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import {
  loadAuthorizedUser,
  logSessionRevocation,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import type { AdminUserAccessService } from './admin-user-access.service';

interface DeleteServices {
  accounts: AdminAccountStore;
  sessions: AccountSessions;
  runner: UnitOfWorkRunner;
  access: AdminUserAccessService;
  logger: Logger;
}

export async function deleteAdminUser(
  services: DeleteServices,
  id: string,
  actorId: string,
  actorPermissions?: readonly string[],
): Promise<void> {
  const { accounts, sessions, runner, access, logger } = services;
  const existing = await accounts.findAccount(id);
  if (!existing || existing.isDeleted) {
    throw new AppException(
      ErrorCode.USER_ALREADY_DELETED,
      'User not found or already deleted',
      HttpStatus.BAD_REQUEST,
    );
  }
  access.assertTargetScope(
    USER_SCOPE_ACTION.DELETE,
    existing.audience,
    actorPermissions,
  );
  access.assertNotSelf(id, actorId, 'Cannot delete your own account');
  try {
    const revoked = await runner.run(async (work) => {
      const current = await loadAuthorizedUser(
        accounts,
        access,
        work,
        id,
        actorId,
        'Cannot delete user with higher or equal role',
        { action: USER_SCOPE_ACTION.DELETE },
      );
      await accounts.saveActivation(work, current, new Date());
      return sessions.revokeAll(work, id, {
        actorId,
        reasonCode: REVOKED_REASON.ADMIN_FORCED,
      });
    });
    logSessionRevocation(logger, id, revoked);
    logger.log(`User ${id} deleted by ${actorId}`);
  } catch (error) {
    rethrowOrUnavailable(error);
  }
}
