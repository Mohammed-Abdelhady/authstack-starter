import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AccountPermissionStore } from '../stores/account-permission.store';
import {
  assertAccountId,
  assertActiveUser,
} from '../utils/account-lookup.util';

interface UserPermissionsData {
  userId: string;
  permissions: string[];
}

interface UserPermissionsWithRole extends UserPermissionsData {
  version: number;
  role: string;
}

/**
 * Direct permission grants held on the user document.
 * Role permissions are resolved separately, see auth/utils/permissions.util.
 */
@Injectable()
export class UserPermissionsService {
  private readonly logger = new Logger(UserPermissionsService.name);

  constructor(private readonly accounts: AccountPermissionStore) {}

  /**
   * Get the direct permissions and role of a user.
   */
  async getUserPermissions(
    userId: string,
  ): Promise<ApiResponse<UserPermissionsWithRole>> {
    this.assertAccountId(userId);

    const grants = await this.accounts.findGrants(userId);

    if (!grants) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return ApiResponse.success({
      userId: grants.id,
      version: grants.version,
      permissions: grants.permissions,
      role: grants.role,
    });
  }

  /**
   * Add permission to user.
   */
  async addPermission(
    userId: string,
    permission: string,
  ): Promise<ApiResponse<UserPermissionsData>> {
    this.assertAccountId(userId);

    const user = await this.accounts.findAccount(userId);
    assertActiveUser(user);

    if (user.permissions.includes(permission)) {
      throw new AppException(
        ErrorCode.PERMISSION_ALREADY_EXISTS,
        'User already has this permission',
        HttpStatus.BAD_REQUEST,
      );
    }

    const permissions = await this.accounts.grantPermission(user, permission);

    this.logger.log(`Permission ${permission} added: userId=${user.id}`);
    return ApiResponse.success(
      {
        userId: user.id,
        permissions,
      },
      'Permission added successfully',
    );
  }

  /**
   * Remove permission from user.
   */
  async removePermission(
    userId: string,
    permission: string,
  ): Promise<ApiResponse<UserPermissionsData>> {
    this.assertAccountId(userId);

    const user = await this.accounts.findAccount(userId);
    assertActiveUser(user);

    if (!user.permissions.includes(permission)) {
      throw new AppException(
        ErrorCode.PERMISSION_NOT_FOUND,
        'User does not have this permission',
        HttpStatus.NOT_FOUND,
      );
    }

    const permissions = await this.accounts.revokePermission(user, permission);

    this.logger.log(`Permission ${permission} removed: userId=${user.id}`);
    return ApiResponse.success(
      {
        userId: user.id,
        permissions,
      },
      'Permission removed successfully',
    );
  }

  private assertAccountId(userId: string): void {
    assertAccountId(
      this.accounts.isAccountId(userId),
      'Invalid user ID format',
    );
  }
}
