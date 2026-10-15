import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../role/stores/role-change.store';
import {
  assertFreshRolePermission,
  FreshRoleActor,
} from '../../role/utils/role-actor.util';
import { StoredAccount } from '../../user/stores/stored-account';
import { AdminUserAccessService } from '../services/users/admin-user-access.service';
import { AdminAccountStore } from '../stores/admin-account.store';
import { loadAuthorizedUser } from '../utils/admin-transaction.util';
import { assertSessionTargetScope } from './utils/admin-session-scope';

@Injectable()
export class AdminSessionAccessService {
  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly access: AdminUserAccessService,
    private readonly roles: RoleChangeStore,
  ) {}

  async authorizeIn(
    unitOfWork: UnitOfWork,
    targetId: string,
    actorId: string,
    permissions: { route: string; staff: string },
  ): Promise<StoredAccount> {
    this.access.assertNotSelf(
      targetId,
      actorId,
      'Cannot manage your own sessions here',
    );
    const actor = await this.freshActor(unitOfWork, actorId, permissions.route);
    // readActor also fences the target against concurrent account edits.
    const targetAuthority = await this.roles.readActor(unitOfWork, targetId);
    if (targetAuthority) {
      await this.roles.readRoleAuthorityBySlug(
        unitOfWork,
        targetAuthority.roleSlug,
      );
    }
    const scopedTarget = await this.accounts.readAccount(unitOfWork, targetId);
    if (scopedTarget) {
      assertSessionTargetScope(
        scopedTarget,
        actor.permissions,
        permissions.staff,
      );
    }
    const target = await loadAuthorizedUser(
      this.accounts,
      this.access,
      unitOfWork,
      targetId,
      actorId,
    );
    return target;
  }

  private async freshActor(
    unitOfWork: UnitOfWork,
    actorId: string,
    permission: string,
  ): Promise<FreshRoleActor> {
    try {
      return await assertFreshRolePermission(
        this.roles,
        unitOfWork,
        actorId,
        permission,
      );
    } catch (error) {
      if (
        error instanceof AppException &&
        error.code === ErrorCode.CANNOT_MODIFY_HIGHER_ROLE
      ) {
        throw new AppException(
          ErrorCode.FORBIDDEN,
          'Actor can no longer manage sessions',
          HttpStatus.FORBIDDEN,
        );
      }
      throw error;
    }
  }
}
