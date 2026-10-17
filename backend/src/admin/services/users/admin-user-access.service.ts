import type { UserScopeAction } from '../../types/user-scope-action';
import type { RoleAudience } from '../../../host/types/host-role.type';
import { AdminAudienceScopes } from './admin-audience-scopes';
import { HttpStatus, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RoleHierarchyService } from '../../../role/services/role-hierarchy.service';
import { StoredAccount } from '../../../user/stores/stored-account';
import { isSameId } from '../../../user/utils/user-lookup.util';
import { AdminAccountStore } from '../../stores/admin-account.store';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import {
  canManageLevel,
  canModifyLevel,
  isAdminRole,
  isValidRoleAssignment,
  LevelActor,
} from '../../../common/utils/role-hierarchy';

/**
 * Lookups and hierarchy checks shared by the admin services.
 * Reads keep the non-strict comparison, mutations use the strict one so peers
 * cannot act on each other.
 */
@Injectable()
export class AdminUserAccessService {
  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly roleHierarchyService: RoleHierarchyService,
    private readonly scopes: AdminAudienceScopes,
  ) {}

  allowedAudiences(action: UserScopeAction, permissions?: readonly string[]) {
    return this.scopes.allowedAudiences(action, permissions);
  }

  scopePermission(action: UserScopeAction, audience?: RoleAudience): string {
    return this.scopes.permission(action, audience);
  }

  assertTargetScope(
    action: UserScopeAction,
    audience: RoleAudience | undefined,
    permissions?: readonly string[],
  ): void {
    this.scopes.assertTarget(action, audience, permissions);
  }

  assertTargetScopeInWork(
    work: UnitOfWork,
    actorId: string,
    audience: RoleAudience | undefined,
    action: UserScopeAction,
  ): Promise<void> {
    return this.scopes.assertInWork(work, actorId, audience, action);
  }

  assertCreateReplay(
    work: UnitOfWork,
    actorId: string,
    audience: RoleAudience | undefined,
  ) {
    return this.scopes.assertCreateReplay(work, actorId, audience);
  }

  /**
   * Load a user that is present and not soft deleted.
   *
   * @throws AppException USER_NOT_FOUND
   */
  async loadActiveUser(id: string): Promise<StoredAccount> {
    const user = await this.accounts.findAccount(id);

    if (!user || user.isDeleted) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        'User not found',
        HttpStatus.NOT_FOUND,
      );
    }

    return user;
  }

  /**
   * Reject an operation an actor aims at its own account, however the letters
   * of the id in the route are cased.
   *
   * @throws AppException CANNOT_MODIFY_SELF
   */
  assertNotSelf(targetId: string, actorId: string, message: string): void {
    if (isSameId(targetId, actorId)) {
      throw new AppException(
        ErrorCode.CANNOT_MODIFY_SELF,
        message,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Read access: the actor may see its own level and below.
   *
   * @throws AppException CANNOT_MODIFY_HIGHER_ROLE
   */
  async assertCanView(actorRole: string, targetRole: string): Promise<void> {
    const [actor, targetLevel] = await this.resolveLevels(
      actorRole,
      targetRole,
    );

    if (!canManageLevel(actor, targetLevel)) {
      throw new AppException(
        ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
        'Cannot view user with higher role',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Write access: the actor's level must exceed the target's level.
   *
   * @throws AppException CANNOT_MODIFY_HIGHER_ROLE
   */
  async assertCanModify(
    actorRole: string,
    targetRole: string,
    message = 'Cannot modify user with higher or equal role',
  ): Promise<void> {
    const [actor, targetLevel] = await this.resolveLevels(
      actorRole,
      targetRole,
    );

    if (!canModifyLevel(actor, targetLevel)) {
      throw new AppException(
        ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
        message,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Check a role slug an actor wants to hand out. The role must exist and sit
   * below the actor's own level. Admin stays out of reach of the API.
   *
   * @throws AppException INVALID_ROLE_ASSIGNMENT, ROLE_NOT_FOUND or
   * CANNOT_MODIFY_HIGHER_ROLE
   */
  async assertCanAssignRole(actorRole: string, newRole: string): Promise<void> {
    if (!isValidRoleAssignment(newRole)) {
      throw new AppException(
        ErrorCode.INVALID_ROLE_ASSIGNMENT,
        'Cannot assign ADMIN role via API',
        HttpStatus.BAD_REQUEST,
      );
    }

    const targetLevel = await this.roleHierarchyService.getLevelOrFail(newRole);
    const actorLevel = await this.getActorLevel(actorRole);

    if (
      !canModifyLevel(
        { level: actorLevel, isAdmin: isAdminRole(actorRole) },
        targetLevel,
      )
    ) {
      throw new AppException(
        ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
        'Cannot assign a role at or above your own level',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Re-read the acting account inside the caller's unit of work and repeat the
   * write check from the role it holds now. A demotion or deactivation that
   * landed after the request was admitted cannot be acted on.
   *
   * @throws AppException SESSION_INVALID when the actor is gone or deleted,
   * CANNOT_MODIFY_HIGHER_ROLE when the fresh rank is not above the target
   */
  async assertFreshActorCanModify(
    actorId: string,
    targetRole: string,
    unitOfWork: UnitOfWork,
    message = 'Cannot modify user with higher or equal role',
    requireAdmin = false,
  ): Promise<void> {
    const actor = await this.accounts.readAccount(unitOfWork, actorId);
    if (!actor || actor.isDeleted) {
      throw new AppException(
        ErrorCode.SESSION_INVALID,
        'Actor is no longer active',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const actorLevel = await this.roleHierarchyService.getLevel(
      actor.role,
      unitOfWork,
    );
    const targetLevel = await this.roleHierarchyService.getLevel(
      targetRole,
      unitOfWork,
    );
    const isAdmin = isAdminRole(actor.role);
    if (requireAdmin && !isAdmin) {
      throw new AppException(
        ErrorCode.EMAIL_CHANGE_NOT_ALLOWED,
        'Only admins can change the email address of another account',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!canModifyLevel({ level: actorLevel, isAdmin }, targetLevel)) {
      throw new AppException(
        ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
        message,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Hierarchy level of the acting user's role.
   */
  async getActorLevel(actorRole: string): Promise<number> {
    return this.roleHierarchyService.getLevel(actorRole);
  }

  /**
   * Role slugs an actor may see in listings, custom roles included.
   */
  async getViewableSlugs(actorRole: string): Promise<string[]> {
    const actorLevel = await this.getActorLevel(actorRole);
    return this.roleHierarchyService.getSlugsAtOrBelow(actorLevel);
  }

  private async resolveLevels(
    actorRole: string,
    targetRole: string,
  ): Promise<[LevelActor, number]> {
    const [actorLevel, targetLevel] = await Promise.all([
      this.roleHierarchyService.getLevel(actorRole),
      this.roleHierarchyService.getLevel(targetRole),
    ]);
    return [
      { level: actorLevel, isAdmin: isAdminRole(actorRole) },
      targetLevel,
    ];
  }
}
