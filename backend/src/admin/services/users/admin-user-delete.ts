import { HttpStatus, type Logger } from '@nestjs/common';
import type { EventRecorder } from '../../../auth/contracts/event-recorder';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import type { AccountSessions } from '../../../user/stores/account-sessions';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import {
  loadAuthorizedUser,
  logSessionRevocation,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import type { StaffMutationPolicy } from '../staff-mutations/staff-mutation-policy';
import type { AdminUserAccessService } from './admin-user-access.service';

export interface DeleteServices {
  accounts: AdminAccountStore;
  sessions: AccountSessions;
  runner: UnitOfWorkRunner;
  access: AdminUserAccessService;
  policy: StaffMutationPolicy;
  events: EventRecorder;
  logger: Logger;
}

export interface AccountDeletion {
  id: string;
  actorId: string;
  session?: ActingSession;
  actorPermissions?: readonly string[];
  version?: number;
}

export async function deleteAdminUser(
  services: DeleteServices,
  deletion: AccountDeletion,
): Promise<void> {
  const { accounts, sessions, runner, access, policy, logger } = services;
  const { id, actorId, session, actorPermissions } = deletion;
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
      await policy.assertRouteProof(work, session);
      const current = await loadAuthorizedUser(
        accounts,
        access,
        work,
        id,
        actorId,
        'Cannot delete user with higher or equal role',
        { action: USER_SCOPE_ACTION.DELETE },
      );
      policy.assertVersion(deletion.version, current.version);
      await accounts.saveActivation(work, current, new Date());
      // The deletion event names the actor, so the sign-out is not a second staff action.
      const count = await sessions.revokeAll(work, id, {
        reasonCode: REVOKED_REASON.ADMIN_FORCED,
      });
      await services.events.record(work, {
        action: SECURITY_EVENT_ACTION.ACCOUNT_DELETED,
        actorId,
        targetUserId: current.id,
        clientId: session?.clientId,
      });
      return count;
    });
    logSessionRevocation(logger, id, revoked);
    logger.log(`User ${id} deleted by ${actorId}`);
  } catch (error) {
    rethrowOrUnavailable(error);
  }
}
