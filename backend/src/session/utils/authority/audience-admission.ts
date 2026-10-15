import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import type { RoleAudience } from '../../../host/types/host-role.type';

export class AudienceAdmissionRefused extends AppException {
  constructor() {
    super(
      ErrorCode.INVALID_CREDENTIALS,
      'Invalid credentials',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

/** Shared with native issue. An application without an audience admits everyone. */
export function assertAudienceAdmission(
  accountAudience: RoleAudience | undefined,
  applicationAudience: RoleAudience | null | undefined,
): void {
  if (applicationAudience && accountAudience !== applicationAudience) {
    throw new AudienceAdmissionRefused();
  }
}
