import { resendAdminEmailChange } from './admin-user-resend';
import { deleteAdminUser } from './admin-user-delete';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import { AudiencePolicy } from '../../../session/applications/audience-policy';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import { RoleSweepStore } from '../../../role/stores/role-sweep.store';
import { AccountSessions } from '../../../user/stores/account-sessions';
import { RoleSweepStores } from '../../../role/sweeps/role-holder-sweep';
import { AdminAccountStore } from '../../stores/admin-account.store';
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
import { assertActorHoldsRole } from '../roles/admin-grant-ceiling';

/** Admin mutations require the actor's level to exceed the target's. */
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
    private readonly audiences: AudiencePolicy,
  ) {}

  /** Update the name, or ask for an address the new mailbox must confirm. */
  async updateUser(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
    actorRole: string,
    actorPermissions?: readonly string[],
  ): Promise<ApiResponse<AdminUserDto>> {
    const { name, email } = dto;
    const targetUser = await this.accessService.loadActiveUser(id);
    this.accessService.assertTargetScope(
      USER_SCOPE_ACTION.UPDATE,
      targetUser.audience,
      actorPermissions,
    );

    this.accessService.assertNotSelf(
      id,
      actorId,
      'Cannot modify your own account through admin panel',
    );
    await this.accessService.assertCanModify(actorRole, targetUser.role);

    const previousEmail = targetUser.email;
    const previousGeneration = targetUser.addressGeneration;
    const pendingEmail =
      email && email !== targetUser.email ? email : undefined;
    if (pendingEmail !== undefined) {
      await this.emailChangeService.assertAddressAvailable(
        pendingEmail,
        actorRole,
        targetUser.id,
      );
    }

    try {
      const saved = await saveUserUpdate(
        this.runner,
        this.accounts,
        this.accessService,
        {
          id,
          actorId,
          name,
          pendingEmail,
          previousEmail,
          previousGeneration,
        },
        this.emailChangeService,
      );
      if (pendingEmail !== undefined) {
        this.emailChangeService.notifyPreviousAddress({
          email: previousEmail,
          locale: saved.locale,
        });
        await this.emailChangeService.sendConfirmation(
          saved,
          actorRole,
          actorId,
        );
      }

      this.logger.log(`User ${id} updated by ${actorId}`);
      return ApiResponse.success(
        mapToAdminUserDto(saved),
        'User updated successfully',
      );
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  resendEmailChange(
    id: string,
    actorId: string,
    actorRole: string,
    actorPermissions?: readonly string[],
  ): Promise<ApiResponse<{ message: string }>> {
    return resendAdminEmailChange(
      {
        access: this.accessService,
        emailChange: this.emailChangeService,
        logger: this.logger,
      },
      { id, actorId, actorRole, actorPermissions },
    );
  }

  /** Activate or deactivate an account. */
  async updateUserStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actorId: string,
    actorPermissions?: readonly string[],
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

        this.accessService.assertTargetScope(
          USER_SCOPE_ACTION.UPDATE,
          target.audience,
          actorPermissions,
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

  async updateUserRole(
    id: string,
    dto: UpdateUserRoleDto,
    actorId: string,
    actorRole: string,
    actorPermissions?: readonly string[],
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
      const outcome = await this.runner.runForAuthority(
        actorId,
        async (unitOfWork) => {
          const current = await loadAuthorizedUser(
            this.accounts,
            this.accessService,
            unitOfWork,
            id,
            actorId,
          );

          this.accessService.assertTargetScope(
            USER_SCOPE_ACTION.UPDATE,
            current.audience,
            actorPermissions,
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
            this.accessService.scopePermission(
              USER_SCOPE_ACTION.UPDATE,
              current.audience,
            ),
            assignedRole.slug,
          );
          const previousRole = await this.accounts.readRoleBySlug(
            unitOfWork,
            current.role,
          );
          this.audiences.assertRoleAssignment(
            current.audience,
            assignedRole.audience,
          );
          await this.accounts.saveRole(unitOfWork, current, newRole);

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
        },
      );

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

  deleteUser(
    id: string,
    actorId: string,
    actorPermissions?: readonly string[],
  ): Promise<void> {
    return deleteAdminUser(
      {
        accounts: this.accounts,
        sessions: this.sessions,
        runner: this.runner,
        access: this.accessService,
        logger: this.logger,
      },
      id,
      actorId,
      actorPermissions,
    );
  }

  private roleStores(): RoleSweepStores {
    return {
      runner: this.runner,
      changes: this.roleChanges,
      sweeps: this.roleSweeps,
      audiencePolicy: this.audiences,
    };
  }
}
