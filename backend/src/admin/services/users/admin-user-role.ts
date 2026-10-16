import { HttpStatus, type Logger } from '@nestjs/common';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import type { RoleChangeStore } from '../../../role/stores/role-change.store';
import type { RoleSweepStores } from '../../../role/sweeps/role-holder-sweep';
import type { AudiencePolicy } from '../../../session/applications/audience-policy';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import type { AccountSessions } from '../../../user/stores/account-sessions';
import { ADMIN_ROLE_CHANGED } from '../../constants/admin-user.constants';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { UpdateUserRoleDto } from '../../dto/update-user-role.dto';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import { reconcileAssignedRole } from '../../utils/admin-role-reconcile.util';
import {
  loadAuthorizedUser,
  logSessionRevocation,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import { assertActorHoldsRole } from '../roles/admin-grant-ceiling';
import type { StaffMutationPolicy } from '../staff-mutations/staff-mutation-policy';
import type { AdminUserAccessService } from './admin-user-access.service';

export interface RoleAssignmentServices {
  accounts: AdminAccountStore;
  sessions: AccountSessions;
  runner: UnitOfWorkRunner;
  roleChanges: RoleChangeStore;
  access: AdminUserAccessService;
  audiences: AudiencePolicy;
  policy: StaffMutationPolicy;
  roles: RoleSweepStores;
  logger: Logger;
}

export interface RoleAssignment {
  id: string;
  dto: UpdateUserRoleDto;
  actorId: string;
  session?: ActingSession;
  actorRole: string;
  actorPermissions?: readonly string[];
}

/**
 * Give an account another role. The assignment keeps its one session
 * revocation event, which carries the role ids the repair of stranded
 * accounts reads.
 */
export async function assignAdminUserRole(
  services: RoleAssignmentServices,
  assignment: RoleAssignment,
): Promise<ApiResponse<{ id: string; role: string; version: number }>> {
  const { accounts, access, policy, logger } = services;
  const { id, dto, actorId, session, actorRole, actorPermissions } = assignment;
  const { role: newRole } = dto;
  await access.loadActiveUser(id);
  access.assertNotSelf(id, actorId, 'Cannot modify your own role');
  await access.assertCanAssignRole(actorRole, newRole);

  try {
    const outcome = await services.runner.runForAuthority(
      actorId,
      async (unitOfWork) => {
        await policy.assertRouteProof(unitOfWork, session);
        const current = await loadAuthorizedUser(
          accounts,
          access,
          unitOfWork,
          id,
          actorId,
        );
        access.assertTargetScope(
          USER_SCOPE_ACTION.UPDATE,
          current.audience,
          actorPermissions,
        );
        policy.assertVersion(dto.version, current.version);
        const assignedRole = await accounts.readRoleBySlug(unitOfWork, newRole);
        if (!assignedRole) {
          throw new AppException(
            ErrorCode.ROLE_NOT_FOUND,
            `Role "${newRole}" does not exist`,
            HttpStatus.NOT_FOUND,
          );
        }
        await access.assertFreshActorCanModify(
          actorId,
          assignedRole.slug,
          unitOfWork,
        );
        await assertActorHoldsRole(
          services.roleChanges,
          unitOfWork,
          actorId,
          access.scopePermission(USER_SCOPE_ACTION.UPDATE, current.audience),
          assignedRole.slug,
        );
        const previousRole = await accounts.readRoleBySlug(
          unitOfWork,
          current.role,
        );
        services.audiences.assertRoleAssignment(
          current.audience,
          assignedRole.audience,
        );
        const saved = await accounts.saveRole(unitOfWork, current, newRole);
        const revoked = await services.sessions.revokeAll(unitOfWork, id, {
          actorId,
          reasonCode: REVOKED_REASON.ADMIN_FORCED,
          roleAssignment: {
            assignedRoleId: assignedRole.id,
            sessionVersion: current.sessionVersion + 1,
            previousRoleId: previousRole?.id,
          },
        });
        return {
          revoked,
          roleId: assignedRole.id,
          previousRoleId: previousRole?.id,
          version: saved.version ?? 0,
        };
      },
    );

    const liveSlug = await reconcileAssignedRole({
      accounts,
      roles: services.roles,
      logger,
      actorId,
      userId: id,
      ref: {
        roleId: outcome.roleId,
        assignedSlug: newRole,
        previousRoleId: outcome.previousRoleId,
      },
    });

    logSessionRevocation(logger, id, outcome.revoked);
    logger.log({
      event: ADMIN_ROLE_CHANGED,
      userId: id,
      role: liveSlug,
      actorId,
    });
    return ApiResponse.success({
      id,
      role: liveSlug,
      version: outcome.version,
    });
  } catch (error) {
    rethrowOrUnavailable(error);
  }
}
