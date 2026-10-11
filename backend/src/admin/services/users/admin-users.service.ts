import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import { RoleSweepStore } from '../../../role/stores/role-sweep.store';
import { AccountSessions } from '../../../user/stores/account-sessions';
import { RoleSweepStores } from '../../../role/sweeps/role-holder-sweep';
import {
  AddressMove,
  AdminAccountStore,
} from '../../stores/admin-account.store';
import {
  loadAuthorizedUser,
  logSessionRevocation,
  rethrowOrUnavailable,
  saveUserUpdate,
} from '../../utils/admin-transaction.util';
import { reconcileAssignedRole } from '../../utils/admin-role-reconcile.util';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import { AdminUserDto } from '../../dto/admin-user-response.dto';
import { UpdateUserStatusDto } from '../../dto/update-user-status.dto';
import { UpdateUserRoleDto } from '../../dto/update-user-role.dto';
import { UpdateUserDto } from '../../dto/update-user.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { ADMIN_ROLE_CHANGED } from '../../constants/admin-user.constants';
import { mapToAdminUserDto } from '../../mappers/admin-user.mapper';
import { AdminUserAccessService } from './admin-user-access.service';
import { AdminEmailChangeService } from './admin-email-change.service';
import { USER_PERMISSIONS } from '../../../common/constants/permissions';
import { assertActorHoldsRole } from '../roles/admin-grant-ceiling';

/**
 * Mutating user operations for the admin area.
 * Every one of them needs the actor's level to exceed the target's level.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly sessions: AccountSessions,
    private readonly runner: UnitOfWorkRunner,
    private readonly roleChanges: RoleChangeStore,
    private readonly roleSweeps: RoleSweepStore,
    private readonly accessService: AdminUserAccessService,
    private readonly emailChangeService: AdminEmailChangeService,
  ) {}

  /** Update name and email; an admin email edit requires verification again. */
  async updateUser(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<AdminUserDto>> {
    const { name, email } = dto;
    const targetUser = await this.accessService.loadActiveUser(id);

    this.accessService.assertNotSelf(
      id,
      actorId,
      'Cannot modify your own account through admin panel',
    );
    await this.accessService.assertCanModify(actorRole, targetUser.role);

    const previousEmail = targetUser.email;
    const previousGeneration = targetUser.addressGeneration;
    let moved: AddressMove | undefined;
    if (email && email !== targetUser.email) {
      const actorLevel = await this.accessService.getActorLevel(actorRole);
      moved = await this.emailChangeService.apply(
        targetUser,
        email,
        actorLevel,
      );
    }

    try {
      const saved = await saveUserUpdate(
        this.runner,
        this.accounts,
        this.accessService,
        { id, actorId, name, moved, previousEmail, previousGeneration },
      );

      this.logger.log(`User ${id} updated by ${actorId}`);
      return ApiResponse.success(
        mapToAdminUserDto(saved),
        'User updated successfully',
      );
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  /**
   * Re-send the confirmation code for the account's current unverified
   * address, without changing the address or its generation.
   */
  async resendEmailChange(
    id: string,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<{ message: string }>> {
    const targetUser = await this.accessService.loadActiveUser(id);

    this.accessService.assertNotSelf(
      id,
      actorId,
      'Cannot modify your own account through admin panel',
    );
    await this.accessService.assertCanModify(actorRole, targetUser.role);

    const actorLevel = await this.accessService.getActorLevel(actorRole);
    await this.emailChangeService.resend(targetUser, actorLevel);

    this.logger.log(`Email change confirmation resent for ${id} by ${actorId}`);
    return ApiResponse.success({ message: 'Confirmation email sent' });
  }

  /** Activate or deactivate an account. */
  async updateUserStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actorId: string,
  ): Promise<
    ApiResponse<{ id: string; isDeleted: boolean; deletedAt?: Date }>
  > {
    const { isActive } = dto;
    // Only a deactivation needs the target to be active beforehand.
    if (!isActive) {
      await this.accessService.loadActiveUser(id);
    }

    this.accessService.assertNotSelf(
      id,
      actorId,
      'Cannot modify your own account',
    );

    try {
      const outcome = await this.runner.run(async (unitOfWork) => {
        const target = await loadAuthorizedUser(
          this.accounts,
          this.accessService,
          unitOfWork,
          id,
          actorId,
          undefined,
          { includeDeleted: isActive },
        );

        const current = await this.accounts.saveActivation(
          unitOfWork,
          target,
          isActive ? undefined : new Date(),
        );

        const revoked = isActive
          ? 0
          : await this.sessions.revokeAll(unitOfWork, id, {
              actorId,
              reasonCode: REVOKED_REASON.ADMIN_FORCED,
            });
        return { current, revoked };
      });

      if (!isActive) {
        logSessionRevocation(this.logger, id, outcome.revoked);
      }
      this.logger.log(
        `User ${id} set ${isActive ? 'active' : 'inactive'} by ${actorId}`,
      );

      return ApiResponse.success({
        id: outcome.current.id,
        isDeleted: outcome.current.isDeleted,
        deletedAt: outcome.current.deletedAt,
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  /**
   * Move a user to another role, system or custom.
   */
  async updateUserRole(
    id: string,
    dto: UpdateUserRoleDto,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<{ id: string; role: string }>> {
    const { role: newRole } = dto;
    await this.accessService.loadActiveUser(id);

    this.accessService.assertNotSelf(
      id,
      actorId,
      'Cannot modify your own role',
    );
    await this.accessService.assertCanAssignRole(actorRole, newRole);

    try {
      const outcome = await this.runner.run(async (unitOfWork) => {
        const current = await loadAuthorizedUser(
          this.accounts,
          this.accessService,
          unitOfWork,
          id,
          actorId,
        );

        const assignedRole = await this.accounts.readRoleBySlug(
          unitOfWork,
          newRole,
        );
        if (!assignedRole) {
          throw new AppException(
            ErrorCode.ROLE_NOT_FOUND,
            `Role "${newRole}" does not exist`,
            HttpStatus.NOT_FOUND,
          );
        }

        await this.accessService.assertFreshActorCanModify(
          actorId,
          assignedRole.slug,
          unitOfWork,
        );
        await assertActorHoldsRole(
          this.roleChanges,
          unitOfWork,
          actorId,
          USER_PERMISSIONS.UPDATE_ALL,
          assignedRole.slug,
        );
        const previousRole = await this.accounts.readRoleBySlug(
          unitOfWork,
          current.role,
        );
        await this.accounts.saveRole(unitOfWork, current, newRole);

        // Permissions travel with the role, so existing sessions must be
        // rebuilt in the same unit of work as the change.
        const revoked = await this.sessions.revokeAll(unitOfWork, id, {
          actorId,
          reasonCode: REVOKED_REASON.ADMIN_FORCED,
          roleAssignment: {
            assignedRoleId: assignedRole.id,
            sessionVersion: current.sessionVersion + 1,
            previousRoleId: previousRole?.id,
          },
        });
        return {
          revoked,
          roleId: assignedRole.id,
          previousRoleId: previousRole?.id,
        };
      });

      const liveSlug = await reconcileAssignedRole({
        accounts: this.accounts,
        roles: this.roleStores(),
        logger: this.logger,
        actorId,
        userId: id,
        ref: {
          roleId: outcome.roleId,
          assignedSlug: newRole,
          previousRoleId: outcome.previousRoleId,
        },
      });

      logSessionRevocation(this.logger, id, outcome.revoked);
      this.logger.log({
        event: ADMIN_ROLE_CHANGED,
        userId: id,
        role: liveSlug,
        actorId,
      });

      return ApiResponse.success({ id, role: liveSlug });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  /**
   * Soft delete a user.
   */
  async deleteUser(id: string, actorId: string): Promise<void> {
    const existing = await this.accounts.findAccount(id);

    if (!existing || existing.isDeleted) {
      throw new AppException(
        ErrorCode.USER_ALREADY_DELETED,
        'User not found or already deleted',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.accessService.assertNotSelf(
      id,
      actorId,
      'Cannot delete your own account',
    );

    try {
      const revoked = await this.runner.run(async (unitOfWork) => {
        const current = await loadAuthorizedUser(
          this.accounts,
          this.accessService,
          unitOfWork,
          id,
          actorId,
          'Cannot delete user with higher or equal role',
        );

        await this.accounts.saveActivation(unitOfWork, current, new Date());
        return this.sessions.revokeAll(unitOfWork, id, {
          actorId,
          reasonCode: REVOKED_REASON.ADMIN_FORCED,
        });
      });

      logSessionRevocation(this.logger, id, revoked);
      this.logger.log(`User ${id} deleted by ${actorId}`);
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  private roleStores(): RoleSweepStores {
    return {
      runner: this.runner,
      changes: this.roleChanges,
      sweeps: this.roleSweeps,
    };
  }
}
