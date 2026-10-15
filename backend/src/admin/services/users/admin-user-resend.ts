import type { Logger } from '@nestjs/common';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminUserAccessService } from './admin-user-access.service';
import type { AdminEmailChangeService } from './admin-email-change.service';

interface ResendServices {
  access: AdminUserAccessService;
  emailChange: AdminEmailChangeService;
  logger: Logger;
}

interface ResendInput {
  id: string;
  actorId: string;
  actorRole: string;
  actorPermissions?: readonly string[];
}

/** Resend the account's pending confirmation after checking its current scope. */
export async function resendAdminEmailChange(
  services: ResendServices,
  input: ResendInput,
): Promise<ApiResponse<{ message: string }>> {
  const { access, emailChange, logger } = services;
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
  await emailChange.resend(target, actorRole, actorId);
  logger.log(`Email change confirmation resent for ${id} by ${actorId}`);
  return ApiResponse.success({ message: 'Confirmation email sent' });
}
