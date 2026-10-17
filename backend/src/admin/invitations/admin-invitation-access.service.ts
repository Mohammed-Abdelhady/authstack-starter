import { HttpStatus, Injectable } from '@nestjs/common';
import { INVITATION_PURPOSE } from '../../auth/invitations/constants/invitations';
import { InvitationStore } from '../../auth/invitations/stores/invitation.store';
import type { StoredInvitation } from '../../auth/invitations/types/invitation';
import { ValidationFailedException } from '../../common/exceptions/validation-failed.exception';
import type { AssignableRole } from '../stores/admin-account.store';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { isAdminRole } from '../../common/utils/role-hierarchy';
import { RoleChangeStore } from '../../role/stores/role-change.store';
import { USER_SCOPE_ACTION } from '../constants/user-scope-permissions';
import { AdminAccountStore } from '../stores/admin-account.store';
import { assertActorHoldsRole } from '../services/roles/admin-grant-ceiling';
import { StaffMutationPolicy } from '../services/staff-mutations/staff-mutation-policy';
import { AdminUserAccessService } from '../services/users/admin-user-access.service';
import { invitationNeedsAct } from './invitation-authority';
import type { AdminInvitationDto } from './dto/admin-invitation.dto';
import type { InvitationActor } from './types/invitation-request';

@Injectable()
export class AdminInvitationAccessService {
  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly invitations: InvitationStore,
    private readonly access: AdminUserAccessService,
    private readonly roles: RoleChangeStore,
    private readonly policy: StaffMutationPolicy,
  ) {}

  async authorizeCreate(
    work: UnitOfWork,
    request: CreateInvitationDto,
    actor: InvitationActor,
  ) {
    const role = await this.authorizeRole(work, request.role, actor);
    this.assertTargetBinding(request, role);
    return role;
  }

  private assertTargetBinding(
    request: CreateInvitationDto,
    role: AssignableRole,
  ): void {
    const { expectedRoleId, expectedAudience } = request;
    if (
      !this.policy.strict &&
      expectedRoleId === undefined &&
      expectedAudience === undefined
    )
      return;
    const fields: Record<string, string[]> = {};
    if (expectedRoleId === undefined)
      fields['expectedRoleId'] = ['Role ID is required'];
    if (expectedAudience === undefined)
      fields['expectedAudience'] = ['Audience is required'];
    const fieldNames = Object.keys(fields);
    if (fieldNames.length > 0) {
      throw new ValidationFailedException(fields, {
        fieldNames,
        omittedCount: 0,
      });
    }
    if (
      expectedRoleId !== role.id ||
      (expectedAudience ?? undefined) !== role.audience
    ) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'The invited role or audience has changed',
        HttpStatus.CONFLICT,
      );
    }
  }

  async authorizeRole(
    work: UnitOfWork,
    slug: string,
    actor: InvitationActor,
    revoking = false,
  ) {
    const role = await this.roles.readRoleAuthorityBySlug(work, slug);
    if (!role)
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        'Role not found',
        HttpStatus.NOT_FOUND,
      );
    this.access.assertTargetScope(
      USER_SCOPE_ACTION.CREATE,
      role.audience,
      actor.permissions,
    );
    await this.access.assertTargetScopeInWork(
      work,
      actor.id,
      role.audience,
      USER_SCOPE_ACTION.CREATE,
    );
    const fresh = await this.accounts.readAccount(work, actor.id);
    if (!fresh || fresh.isDeleted) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Actor is no longer active',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (invitationNeedsAct(actor.role, role.slug, revoking)) {
      invitationNeedsAct(fresh.role, role.slug, revoking);
      await this.policy.assertAct(work, actor.session);
    } else if (isAdminRole(role.slug)) {
      invitationNeedsAct(fresh.role, role.slug, revoking);
    } else {
      await this.access.assertCanAssignRole(actor.role, role.slug);
      await this.access.assertFreshActorCanModify(actor.id, role.slug, work);
    }
    await assertActorHoldsRole(
      this.roles,
      work,
      actor.id,
      this.access.scopePermission(USER_SCOPE_ACTION.CREATE, role.audience),
      role.slug,
    );
    return role;
  }

  async authorizeReplay(
    work: UnitOfWork,
    invitation: AdminInvitationDto,
    actor: InvitationActor,
  ): Promise<void> {
    this.access.assertTargetScope(
      USER_SCOPE_ACTION.CREATE,
      invitation.audience,
      actor.permissions,
    );
    const fresh = await this.access.assertCreateReplay(
      work,
      actor.id,
      invitation.audience,
    );
    if (isAdminRole(invitation.role)) {
      if (!fresh.isAdmin)
        throw new AppException(
          ErrorCode.FORBIDDEN,
          'Only administrators may invite administrators',
          HttpStatus.FORBIDDEN,
        );
      await this.policy.assertAct(work, actor.session);
    }
  }

  async load(
    work: UnitOfWork,
    id: string,
    actor: InvitationActor,
    replay = false,
  ): Promise<StoredInvitation> {
    const invitation = replay
      ? await this.invitations.findById(id)
      : await this.invitations.takeById(work, id);
    if (!invitation || invitation.purpose === INVITATION_PURPOSE.ENROLMENT) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        'Invitation not found',
        HttpStatus.NOT_FOUND,
      );
    }
    this.access.assertTargetScope(
      USER_SCOPE_ACTION.CREATE,
      invitation.audience,
      actor.permissions,
    );
    await this.access.assertTargetScopeInWork(
      work,
      actor.id,
      invitation.audience,
      USER_SCOPE_ACTION.CREATE,
    );
    return invitation;
  }

  /**
   * Revoking needs the audience scope that `load` checked, an administrator for
   * an administrator invitation, and the level rule while the invited role
   * still exists. A deleted or renamed role leaves the invitation unusable, so
   * it does not block the revocation that frees the address.
   */
  async authorizeRevocation(
    work: UnitOfWork,
    invitation: StoredInvitation,
    actor: InvitationActor,
  ): Promise<void> {
    const slug = invitation.roleSlug ?? '';
    const role = await this.accounts.readRoleBySlug(work, slug);
    if (isAdminRole(slug) || role?.id !== invitation.roleId) {
      const fresh = await this.accounts.readAccount(work, actor.id);
      if (!fresh || fresh.isDeleted) {
        throw new AppException(
          ErrorCode.SESSION_INVALID,
          'Actor is no longer active',
          HttpStatus.UNAUTHORIZED,
        );
      }
      invitationNeedsAct(fresh.role, slug, true);
      return;
    }
    await this.authorizeInvitation(work, invitation, actor, true);
  }

  async authorizeInvitation(
    work: UnitOfWork,
    invitation: StoredInvitation,
    actor: InvitationActor,
    revoking = false,
  ) {
    const role = await this.authorizeRole(
      work,
      invitation.roleSlug ?? '',
      actor,
      revoking,
    );
    if (role.id !== invitation.roleId) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'The invited role has changed',
        HttpStatus.CONFLICT,
      );
    }
    return role;
  }
}
