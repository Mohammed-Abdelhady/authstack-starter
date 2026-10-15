import { permissionsRequireStaff } from '../utils/authority/audience-permissions';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { configuredAccountAudiences } from '../../config/utils/application-audiences';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../host/types/host-role.type';

@Injectable()
export class AudiencePolicy {
  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return configuredAccountAudiences(this.config).length > 0;
  }

  staffGuardEnabled(): boolean {
    return configuredAccountAudiences(this.config).includes(
      ROLE_AUDIENCE.STAFF,
    );
  }

  assertRoleAssignment(
    accountAudience: RoleAudience | undefined,
    roleAudience: RoleAudience | undefined,
  ): void {
    if (!this.enabled()) return;
    if (accountAudience && accountAudience === roleAudience) return;
    throw new AppException(
      ErrorCode.INVALID_ROLE_ASSIGNMENT,
      'The account and role must have the same audience',
      HttpStatus.BAD_REQUEST,
    );
  }

  assertDirectPermissions(
    accountAudience: RoleAudience | undefined,
    permissions: readonly string[],
  ): void {
    if (!this.enabled() || accountAudience === ROLE_AUDIENCE.STAFF) return;
    if (!permissionsRequireStaff(permissions)) return;
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'Staff permissions require a staff audience',
      HttpStatus.FORBIDDEN,
    );
  }
}
