import type { Logger } from '@nestjs/common';
import type { EventRecorder } from '../../../auth/contracts/event-recorder';
import type { ErasureLock } from '../../../auth/contracts/erasure-lock';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import type { AccountSessions } from '../../../user/stores/account-sessions';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { UpdateUserStatusDto } from '../../dto/update-user-status.dto';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import {
  loadAuthorizedUser,
  logSessionRevocation,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import type { StaffMutationPolicy } from '../staff-mutations/staff-mutation-policy';
import type { AdminUserAccessService } from './admin-user-access.service';

export interface StatusServices {
  accounts: AdminAccountStore;
  sessions: AccountSessions;
  runner: UnitOfWorkRunner;
  access: AdminUserAccessService;
  policy: StaffMutationPolicy;
  events: EventRecorder;
  erasure: ErasureLock;
  logger: Logger;
}

export interface StatusChange {
  id: string;
  dto: UpdateUserStatusDto;
  actorId: string;
  session?: ActingSession;
  actorPermissions?: readonly string[];
}

export interface StatusResult {
  id: string;
  isDeleted: boolean;
  deletedAt?: Date;
  version: number;
}

/**
 * Suspend or restore an account. Suspending needs a suspend permission of
 * its own; a restore takes the erasure lock so it cannot race the worker.
 */
export async function changeAdminUserStatus(
  services: StatusServices,
  change: StatusChange,
): Promise<ApiResponse<StatusResult>> {
  const { accounts, sessions, runner, access, policy, events, logger } =
    services;
  const { id, dto, actorId, session, actorPermissions } = change;
  const { isActive } = dto;
  // Only a suspension needs the target to be active beforehand.
  if (!isActive) await access.loadActiveUser(id);
  access.assertNotSelf(id, actorId, 'Cannot modify your own account');

  try {
    const outcome = await runner.run(async (work) => {
      const target = await loadAuthorizedUser(
        accounts,
        access,
        work,
        id,
        actorId,
        undefined,
        { includeDeleted: isActive, action: USER_SCOPE_ACTION.SUSPEND },
      );
      access.assertTargetScope(
        USER_SCOPE_ACTION.SUSPEND,
        target.audience,
        actorPermissions,
      );
      policy.assertVersion(dto.version, target.version);
      if (isActive && target.isDeleted) {
        await services.erasure.assertRestorable(work, target.id);
      }
      const current = await accounts.saveActivation(
        work,
        target,
        isActive ? undefined : new Date(),
      );
      // The status event names the actor, so the sign-out is not a second staff action.
      const revoked = isActive
        ? 0
        : await sessions.revokeAll(work, id, {
            reasonCode: REVOKED_REASON.ADMIN_FORCED,
          });
      await events.record(work, {
        action: SECURITY_EVENT_ACTION.ACCOUNT_STATUS_CHANGED,
        actorId,
        targetUserId: current.id,
        clientId: session?.clientId,
        details: { isDeleted: current.isDeleted },
      });
      return { current, revoked };
    });

    if (!isActive) logSessionRevocation(logger, id, outcome.revoked);
    logger.log(
      `User ${id} set ${isActive ? 'active' : 'inactive'} by ${actorId}`,
    );
    return ApiResponse.success({
      id: outcome.current.id,
      isDeleted: outcome.current.isDeleted,
      deletedAt: outcome.current.deletedAt,
      version: outcome.current.version ?? 0,
    });
  } catch (error) {
    rethrowOrUnavailable(error);
  }
}
