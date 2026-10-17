import { Injectable } from '@nestjs/common';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import {
  UnitOfWorkRunner,
  type UnitOfWork,
} from '../../../common/persistence/unit-of-work';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import type { StoredAccount } from '../../../user/stores/stored-account';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import { AdminAccountStore } from '../../stores/admin-account.store';
import type { EmailCancellation } from '../../types/email-cancellation';
import { mapToAdminUserDto } from '../../mappers/admin-user.mapper';
import {
  loadAuthorizedUser,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import { LastAdminGuard } from '../staff-mutations/last-admin-guard';
import { StaffMutationRules } from '../staff-mutations/staff-mutation-rules';
import { AdminUserAccessService } from './admin-user-access.service';
import { loadPeerTarget } from './admin-peer-email-target';

export interface AdminEmailCancellationServiceDependencies {
  accounts: AdminAccountStore;
  access: AdminUserAccessService;
  runner: UnitOfWorkRunner;
  rules: StaffMutationRules;
  lastAdmin: LastAdminGuard;
  ledger: AddressLedger;
}

@Injectable()
export class AdminEmailCancellationService {
  constructor(
    private readonly dependencies: AdminEmailCancellationServiceDependencies,
  ) {}

  async cancel(request: EmailCancellation) {
    const target = await this.dependencies.access.loadActiveUser(request.id);
    this.dependencies.access.assertTargetScope(
      USER_SCOPE_ACTION.UPDATE,
      target.audience,
      request.actorPermissions,
    );
    this.dependencies.access.assertNotSelf(
      request.id,
      request.actorId,
      'Cannot modify your own account through admin panel',
    );
    const peer = isAdminRole(target.role) && isAdminRole(request.actorRole);
    if (!peer)
      await this.dependencies.access.assertCanModify(
        request.actorRole,
        target.role,
      );
    try {
      return await this.dependencies.runner.run(async (work) => {
        const saved = await this.cancelIn(work, request, peer);
        const activity = await this.dependencies.accounts.lastActiveFor(
          [saved.id],
          work,
        );
        return ApiResponse.success(
          mapToAdminUserDto(saved, activity.get(saved.id) ?? null),
        );
      });
    } catch (error) {
      rethrowOrUnavailable(error);
    }
  }

  private async cancelIn(
    work: UnitOfWork,
    request: EmailCancellation,
    peer: boolean,
  ): Promise<StoredAccount> {
    if (peer) {
      await this.dependencies.rules.policy.assertAct(work, request.session);
      await this.dependencies.lastAdmin.lock(work);
    } else {
      await this.dependencies.rules.policy.assertRouteProof(
        work,
        request.session,
      );
    }
    const services = {
      accounts: this.dependencies.accounts,
      access: this.dependencies.access,
    };
    const current = peer
      ? await loadPeerTarget(services, work, request)
      : await loadAuthorizedUser(
          this.dependencies.accounts,
          this.dependencies.access,
          work,
          request.id,
          request.actorId,
          undefined,
          { requireAdmin: true },
        );
    this.dependencies.rules.policy.assertVersion(
      request.version,
      current.version,
    );
    if (!current.pendingEmail) return current;
    await this.dependencies.ledger.release(work, {
      address: current.pendingEmail,
      owner: current.id,
    });
    const saved = await this.dependencies.accounts.saveIdentity(work, current, {
      address: {
        email: null,
        addressGeneration: current.addressGeneration + 1,
      },
    });
    await this.dependencies.rules.events.record(work, {
      action: SECURITY_EVENT_ACTION.ACCOUNT_UPDATED,
      actorId: request.actorId,
      targetUserId: saved.id,
      clientId: request.session.clientId,
      details: { changedFields: ['email'] },
    });
    return saved;
  }
}
