import type { ActingSession } from '../../../auth/proof/types/acting-session';
import type { StaffMutationPolicy } from '../staff-mutations/staff-mutation-policy';
import type { RoleChangeStore } from '../../../role/stores/role-change.store';
import { assertFreshRolePermission } from '../../../role/utils/role-actor.util';
import type { Logger } from '@nestjs/common';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminUserAccessService } from './admin-user-access.service';
import type { AdminEmailChangeService } from './admin-email-change.service';

interface ResendServices {
  access: AdminUserAccessService;
  emailChange: AdminEmailChangeService;
  logger: Logger;
  policy: StaffMutationPolicy;
  roleChanges: RoleChangeStore;
}

export interface AdminEmailResend {
  id: string;
  actorId: string;
  actorRole: string;
  actorPermissions?: readonly string[];
  version?: number;
  session?: ActingSession;
}

/** Resend the account's pending confirmation after checking its current scope. */
export async function resendAdminEmailChange(
  services: ResendServices,
  input: AdminEmailResend,
): Promise<ApiResponse<{ message: string }>> {
  const { access, emailChange, logger, policy } = services;
  const { id, actorId, actorRole, actorPermissions } = input;
  const target = await access.loadActiveUser(id);
  access.assertTargetScope(
    USER_SCOPE_ACTION.UPDATE,
    target.audience,
    actorPermissions,
  );
  access.assertNotSelf(
    id,
    actorId,
    'Cannot modify your own account through admin panel',
  );
  await access.assertCanModify(actorRole, target.role);
  policy.assertVersion(input.version, target.version);
  await emailChange.resend(target, actorRole, {
    actorId,
    assertCurrent: async (work, current) => {
      await policy.assertRouteProof(work, input.session);
      await assertFreshRolePermission(
        services.roleChanges,
        work,
        actorId,
        access.scopePermission(USER_SCOPE_ACTION.UPDATE, current.audience),
      );
      await access.assertFreshActorCanModify(
        actorId,
        current.role,
        work,
        undefined,
        true,
      );
      policy.assertVersion(input.version, current.version);
    },
  });
  logger.log(`Email change confirmation resent for ${id} by ${actorId}`);
  return ApiResponse.success({ message: 'Confirmation email sent' });
}
