import { HttpStatus, Injectable } from '@nestjs/common';
import { AudiencePolicy } from '../../../session/applications/audience-policy';
import {
  ROLE_AUDIENCE,
  type RoleAudience,
} from '../../../host/types/host-role.type';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { hasPermission } from '../../../common/utils/permission.utils';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import { assertFreshRolePermission } from '../../../role/utils/role-actor.util';
import { USER_SCOPE_PERMISSIONS } from '../../constants/user-scope-permissions';
import type { UserScopeAction } from '../../types/user-scope-action';

@Injectable()
export class AdminAudienceScopes {
  constructor(
    private readonly policy: AudiencePolicy,
    private readonly roles: RoleChangeStore,
  ) {}

  permission(action: UserScopeAction, audience?: RoleAudience): string {
    return USER_SCOPE_PERMISSIONS[action][
      this.policy.enabled() && audience === ROLE_AUDIENCE.STAFF
        ? ROLE_AUDIENCE.STAFF
        : ROLE_AUDIENCE.CUSTOMER
    ];
  }

  allowedAudiences(
    action: UserScopeAction,
    permissions?: readonly string[],
  ): RoleAudience[] | undefined {
    if (!this.policy.enabled()) {
      this.assertTarget(action, undefined, permissions);
      return undefined;
    }
    return Object.values(ROLE_AUDIENCE).filter((audience) =>
      hasPermission(
        [...(permissions ?? [])],
        this.permission(action, audience),
      ),
    );
  }

  assertTarget(
    action: UserScopeAction,
    audience: RoleAudience | undefined,
    permissions?: readonly string[],
  ): void {
    if (!this.policy.enabled() && permissions === undefined) return;
    if (
      (this.policy.enabled() && audience === undefined) ||
      !hasPermission(
        [...(permissions ?? [])],
        this.permission(action, audience),
      )
    ) {
      throw this.refused();
    }
  }

  async assertInWork(
    work: UnitOfWork,
    actorId: string | undefined,
    audience: RoleAudience | undefined,
    action: UserScopeAction,
  ): Promise<void> {
    if (!this.policy.enabled()) return;
    if (!actorId || audience === undefined) throw this.refused();
    try {
      await assertFreshRolePermission(
        this.roles,
        work,
        actorId,
        this.permission(action, audience),
      );
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.CANNOT_MODIFY_HIGHER_ROLE
      ) {
        throw this.refused();
      }
      throw error;
    }
  }

  private refused(): AppException {
    return new AppException(
      ErrorCode.FORBIDDEN,
      'The account is outside the permitted audience scope',
      HttpStatus.FORBIDDEN,
    );
  }
}
