import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import { hasPermission } from '../../../common/utils/permission.utils';
import { UserRole } from '../../../user/enums/user-role.enum';
import { StoredAccount } from '../../../user/stores/stored-account';

export function assertSessionTargetScope(
  target: StoredAccount,
  permissions: string[],
  staffPermission: string,
): void {
  // Until audience storage lands, custom roles are conservatively staff-only.
  const customer =
    'audience' in target
      ? target.audience === 'customer'
      : target.role === (UserRole.USER as string);
  if (customer || hasPermission(permissions, staffPermission)) return;
  throw new AppException(
    ErrorCode.USER_NOT_FOUND,
    'User not found',
    HttpStatus.NOT_FOUND,
  );
}
