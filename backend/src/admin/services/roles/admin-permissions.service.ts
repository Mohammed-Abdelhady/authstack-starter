import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UserPermissionsService } from '../../../user/services/user-permissions.service';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { PERMISSION_PERMISSIONS } from '../../../common/constants/permissions';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import {
  loadAuthorizedUser,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import { AdminUserAccessService } from '../users/admin-user-access.service';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { assertActorHolds } from './admin-grant-ceiling';
import { StoredAccount } from '../../../user/stores/stored-account';

interface UserPermissionsData {
  userId: string;
  permissions: string[];
}

interface UserPermissionsWithRole extends UserPermissionsData {
  role: string;
}

/**
 * Direct permission grants handled from the admin area.
 * Reads keep the non-strict hierarchy comparison. Permission writes repeat
 * the target and actor checks in the same unit of work as the account write.
 */
@Injectable()
export class AdminPermissionsService {
  private readonly logger = new Logger(AdminPermissionsService.name);

  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly accessService: AdminUserAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly runner: UnitOfWorkRunner,
    private readonly roleChanges: RoleChangeStore,
  ) {}

  /** Read the permissions of a user the actor is allowed to see. */
  async getUserPermissions(
    userId: string,
    actorRole: string,
  ): Promise<ApiResponse<UserPermissionsWithRole>> {
    const target = await this.accessService.loadActiveUser(userId);
    await this.accessService.assertCanView(actorRole, target.role);

    return this.userPermissionsService.getUserPermissions(userId);
  }

  /** Grant a direct permission the actor holds to a user below its level. */
  async addPermission(
    userId: string,
    permission: string,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<UserPermissionsData>> {
    await this.assertCanGrant(userId, actorId, actorRole);
    const saved = await this.changePermissions(
      userId,
      actorId,
      permission,
      'grant',
    );
    this.logger.log(`Granting ${permission} on user ${userId} by ${actorId}`);

    return ApiResponse.success(
      { userId: saved.id, permissions: saved.permissions },
      'Permission added successfully',
    );
  }

  /** Revoke a direct permission from a user below the actor's level. */
  async removePermission(
    userId: string,
    permission: string,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<UserPermissionsData>> {
    await this.assertCanGrant(userId, actorId, actorRole);
    const saved = await this.changePermissions(
      userId,
      actorId,
      permission,
      'revoke',
    );
    this.logger.log(`Revoking ${permission} on user ${userId} by ${actorId}`);

    return ApiResponse.success(
      { userId: saved.id, permissions: saved.permissions },
      'Permission removed successfully',
    );
  }

  private async changePermissions(
    userId: string,
    actorId: string,
    permission: string,
    change: 'grant' | 'revoke',
  ): Promise<StoredAccount> {
    try {
      return await this.runner.runForAuthority(actorId, async (unitOfWork) => {
        const target = await this.loadAuthorizedTarget(
          unitOfWork,
          userId,
          actorId,
        );
        if (change === 'grant') {
          await assertActorHolds(
            this.roleChanges,
            unitOfWork,
            actorId,
            PERMISSION_PERMISSIONS.GRANT_ALL,
            [permission],
          );
          this.assertPermissionAbsent(target, permission);
          return this.accounts.savePermissions(unitOfWork, target, [
            ...target.permissions,
            permission,
          ]);
        }

        await assertActorHolds(
          this.roleChanges,
          unitOfWork,
          actorId,
          PERMISSION_PERMISSIONS.REVOKE_ALL,
          [],
        );
        this.assertPermissionPresent(target, permission);
        return this.accounts.savePermissions(
          unitOfWork,
          target,
          target.permissions.filter((granted) => granted !== permission),
        );
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  private async loadAuthorizedTarget(
    unitOfWork: UnitOfWork,
    userId: string,
    actorId: string,
  ): Promise<StoredAccount> {
    return loadAuthorizedUser(
      this.accounts,
      this.accessService,
      unitOfWork,
      userId,
      actorId,
      'Cannot change permissions of a user with higher or equal role',
    );
  }

  private assertPermissionAbsent(
    target: StoredAccount,
    permission: string,
  ): void {
    if (target.permissions.includes(permission)) {
      throw new AppException(
        ErrorCode.PERMISSION_ALREADY_EXISTS,
        'User already has this permission',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertPermissionPresent(
    target: StoredAccount,
    permission: string,
  ): void {
    if (!target.permissions.includes(permission)) {
      throw new AppException(
        ErrorCode.PERMISSION_NOT_FOUND,
        'User does not have this permission',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async assertCanGrant(
    userId: string,
    actorId: string,
    actorRole: string,
  ): Promise<void> {
    const target = await this.accessService.loadActiveUser(userId);

    this.accessService.assertNotSelf(
      userId,
      actorId,
      'Cannot change your own permissions',
    );
    await this.accessService.assertCanModify(
      actorRole,
      target.role,
      'Cannot change permissions of a user with higher or equal role',
    );
  }
}
