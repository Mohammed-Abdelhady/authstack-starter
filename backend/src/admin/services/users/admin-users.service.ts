import {
  resendAdminEmailChange,
  type AdminEmailResend,
} from './admin-user-resend';
import { deleteAdminUser } from './admin-user-delete';
import { changeAdminUserStatus, StatusResult } from './admin-user-status';
import { assignAdminUserRole } from './admin-user-role';
import { updateAdminUser } from './admin-user-update';
import { AudiencePolicy } from '../../../session/applications/audience-policy';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { SecurityNoticeService } from '../../../user/services/security-notice.service';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import { RoleSweepStore } from '../../../role/stores/role-sweep.store';
import { AccountSessions } from '../../../user/stores/account-sessions';
import { RoleSweepStores } from '../../../role/sweeps/role-holder-sweep';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { AdminUserDto } from '../../dto/admin-user-response.dto';
import { UpdateUserStatusDto } from '../../dto/update-user-status.dto';
import { UpdateUserRoleDto } from '../../dto/update-user-role.dto';
import { UpdateUserDto } from '../../dto/update-user.dto';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { ErasureLock } from '../../../auth/contracts/erasure-lock';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { StaffMutationRules } from '../staff-mutations/staff-mutation-rules';
import { LastAdminGuard } from '../staff-mutations/last-admin-guard';
import { AdminUserAccessService } from './admin-user-access.service';
import { AdminEmailChangeService } from './admin-email-change.service';

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
    private readonly rules: StaffMutationRules,
    private readonly erasure: ErasureLock,
    private readonly lastAdmin: LastAdminGuard,
    @Optional() private readonly notices?: SecurityNoticeService,
  ) {}

  /** Update the name, or ask for an address the new mailbox must confirm. */
  updateUser(
    id: string,
    dto: UpdateUserDto,
    actorId: string,
    actorRole: string,
    actorPermissions?: readonly string[],
    session?: ActingSession,
  ): Promise<ApiResponse<AdminUserDto>> {
    return updateAdminUser(
      {
        accounts: this.accounts,
        access: this.accessService,
        emailChange: this.emailChangeService,
        runner: this.runner,
        policy: this.rules.policy,
        events: this.rules.events,
        lastAdmin: this.lastAdmin,
        logger: this.logger,
      },
      { id, dto, actorId, session, actorRole, actorPermissions },
    );
  }

  resendEmailChange(
    id: string,
    command: Omit<AdminEmailResend, 'id'>,
  ): Promise<ApiResponse<{ message: string }>>;
  resendEmailChange(
    id: string,
    actorId: string,
    actorRole: string,
  ): Promise<ApiResponse<{ message: string }>>;
  resendEmailChange(
    id: string,
    actor: string | Omit<AdminEmailResend, 'id'>,
    legacyRole = '',
  ): Promise<ApiResponse<{ message: string }>> {
    const command =
      typeof actor === 'string'
        ? { actorId: actor, actorRole: legacyRole }
        : actor;
    return resendAdminEmailChange(
      {
        access: this.accessService,
        emailChange: this.emailChangeService,
        policy: this.rules.policy,
        roleChanges: this.roleChanges,
        logger: this.logger,
      },
      { id, ...command },
    );
  }

  /** Suspend or restore an account. */
  updateUserStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actorId: string,
    actorPermissions?: readonly string[],
    session?: ActingSession,
  ): Promise<ApiResponse<StatusResult>> {
    return changeAdminUserStatus(
      {
        accounts: this.accounts,
        sessions: this.sessions,
        runner: this.runner,
        access: this.accessService,
        policy: this.rules.policy,
        events: this.rules.events,
        erasure: this.erasure,
        notices: this.notices,
        logger: this.logger,
      },
      { id, dto, actorId, session, actorPermissions },
    );
  }

  updateUserRole(
    id: string,
    dto: UpdateUserRoleDto,
    actorId: string,
    actorRole: string,
    actorPermissions?: readonly string[],
    session?: ActingSession,
  ): Promise<ApiResponse<{ id: string; role: string; version: number }>> {
    return assignAdminUserRole(
      {
        accounts: this.accounts,
        sessions: this.sessions,
        runner: this.runner,
        roleChanges: this.roleChanges,
        access: this.accessService,
        audiences: this.audiences,
        policy: this.rules.policy,
        roles: this.roleStores(),
        logger: this.logger,
      },
      { id, dto, actorId, session, actorRole, actorPermissions },
    );
  }

  deleteUser(
    id: string,
    actorId: string,
    actorPermissions?: readonly string[],
    session?: ActingSession,
    version?: number,
  ): Promise<void> {
    return deleteAdminUser(
      {
        accounts: this.accounts,
        sessions: this.sessions,
        runner: this.runner,
        access: this.accessService,
        policy: this.rules.policy,
        events: this.rules.events,
        notices: this.notices,
        logger: this.logger,
      },
      { id, actorId, session, actorPermissions, version },
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
