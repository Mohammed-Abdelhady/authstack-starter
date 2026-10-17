import { HttpStatus } from '@nestjs/common';
import { isAdminRole } from '../../common/utils/role-hierarchy';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';

export function invitationNeedsAct(
  actorRole: string,
  targetRole: string,
  revoking = false,
): boolean {
  if (!isAdminRole(targetRole)) return false;
  if (!isAdminRole(actorRole)) {
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'Only administrators may invite administrators',
      HttpStatus.FORBIDDEN,
    );
  }
  return !revoking;
}
