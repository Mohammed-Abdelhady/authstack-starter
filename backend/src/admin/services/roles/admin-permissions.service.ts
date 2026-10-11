import { Injectable, Logger } from '@nestjs/common';
import { UserPermissionsService } from '../../../user/services/user-permissions.service';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { PERMISSION_PERMISSIONS } from '../../../common/constants/permissions';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import { rethrowOrUnavailable } from '../../utils/admin-transaction.util';
import { AdminUserAccessService } from '../users/admin-user-access.service';
import { assertActorHolds } from './admin-grant-ceiling';

interface UserPermissionsData {
  userId: string;
  permissions: string[];
}

interface UserPermissionsWithRole extends UserPermissionsData {
  role: string;
}

/**
 * Direct permission grants handled from the admin area.
 * Reading a user's permissions follows the non-strict hierarchy comparison,
 * granting and revoking follow the strict one. A grant also follows the role
 * ceiling: the actor hands out only what it holds.
 */
@Injectable()
export class AdminPermissionsService {
  private readonly logger = new Logger(AdminPermissionsService.name);

  constructor(
    private readonly accessService: AdminUserAccessService,
    private readonly userPermissionsService: UserPermissionsService,
    private readonly runner: UnitOfWorkRunner,
    private readonly roleChanges: RoleChangeStore,
  ) {}

  /**
   * Read the permissions of a user the actor is allowed to see.
   */
  async getUserPermissions(
    userId: string,
    actorRole: string,
  ): Promise<ApiResponse<UserPermissionsWithRole>> {
    const target = await this.accessService.loadActiveUser(userId);
    await this.accessService.assertCanView(actorRole, target.role);

    return this.userPermissionsService.getUserPermissions(userId);
  }

  /**
   * Grant a direct permission the actor holds to a user below its level.
   */
  async addPermission(
    userId: string,
    permission: string,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<UserPermissionsData>> {
    await this.assertCanGrant(userId, actorId, actorRole);
    await this.assertWithinCeiling(actorId, permission);
    this.logger.log(`Granting ${permission} on user ${userId} by ${actorId}`);

    return this.userPermissionsService.addPermission(userId, permission);
  }

  /**
   * Revoke a direct permission from a user below the actor's level.
   */
  async removePermission(
    userId: string,
    permission: string,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<UserPermissionsData>> {
    await this.assertCanGrant(userId, actorId, actorRole);
    this.logger.log(`Revoking ${permission} on user ${userId} by ${actorId}`);

    return this.userPermissionsService.removePermission(userId, permission);
  }

  private async assertWithinCeiling(
    actorId: string,
    permission: string,
  ): Promise<void> {
    try {
      await this.runner.run((unitOfWork) =>
        assertActorHolds(
          this.roleChanges,
          unitOfWork,
          actorId,
          PERMISSION_PERMISSIONS.GRANT_ALL,
          [permission],
        ),
      );
    } catch (error) {
      rethrowOrUnavailable(error);
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
