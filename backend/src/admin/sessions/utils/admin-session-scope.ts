import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { hasPermission } from '../../../common/utils/permission.utils';
import {
  ROLE_AUDIENCE,
  RoleAudience,
} from '../../../host/types/host-role.type';
import { UserRole } from '../../../user/enums/user-role.enum';
import { StoredAccount } from '../../../user/stores/stored-account';

export function sessionTargetClass(target: StoredAccount): RoleAudience {
  // Until audience storage lands, custom roles are conservatively staff-only.
  const customer =
    'audience' in target
      ? target.audience === ROLE_AUDIENCE.CUSTOMER
      : target.role === (UserRole.USER as string);
  return customer ? ROLE_AUDIENCE.CUSTOMER : ROLE_AUDIENCE.STAFF;
}

export function assertSessionTargetScope(
  target: StoredAccount,
  permissions: string[],
  staffPermission: string,
): void {
  if (
    sessionTargetClass(target) === ROLE_AUDIENCE.CUSTOMER ||
    hasPermission(permissions, staffPermission)
  )
    return;
  throw new AppException(
    ErrorCode.USER_NOT_FOUND,
    'User not found',
    HttpStatus.NOT_FOUND,
  );
}
