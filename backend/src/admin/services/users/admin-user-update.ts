import { loadPeerTarget, peerRefusal } from './admin-peer-email-target';
import { HttpStatus, type Logger } from '@nestjs/common';
import type { EventRecorder } from '../../../auth/contracts/event-recorder';
import type { ActingSession } from '../../../auth/proof/types/acting-session';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AppException } from '../../../common/exceptions/app.exception';
import type {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import { SECURITY_EVENT_ACTION } from '../../../session/constants/security-event-action';
import type { StoredAccount } from '../../../user/stores/stored-account';
import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import type { AdminUserDto } from '../../dto/admin-user-response.dto';
import type { UpdateUserDto } from '../../dto/update-user.dto';
import { mapToAdminUserDto } from '../../mappers/admin-user.mapper';
import type { AdminAccountStore } from '../../stores/admin-account.store';
import {
  loadAuthorizedUser,
  rethrowOrUnavailable,
} from '../../utils/admin-transaction.util';
import type { LastAdminGuard } from '../staff-mutations/last-admin-guard';
import type { StaffMutationPolicy } from '../staff-mutations/staff-mutation-policy';
import type { AdminEmailChangeService } from './admin-email-change.service';
import type { AdminUserAccessService } from './admin-user-access.service';

export interface UpdateServices {
  accounts: AdminAccountStore;
  access: AdminUserAccessService;
  emailChange: AdminEmailChangeService;
  runner: UnitOfWorkRunner;
  policy: StaffMutationPolicy;
  events: EventRecorder;
  lastAdmin: LastAdminGuard;
  logger: Logger;
}

export interface UserUpdate {
  id: string;
  dto: UpdateUserDto;
  actorId: string;
  session?: ActingSession;
  actorRole: string;
  actorPermissions?: readonly string[];
}

interface PlannedUpdate {
  target: StoredAccount;
  name?: string;
  pendingEmail?: string;
  /** An administrator moving another administrator to a new address. */
  peer: boolean;
}

/**
 * Rename an account, or ask for an address the new mailbox must confirm. An
 * administrator may start an address change for another administrator, and
 * nothing else, with a fresh act, while one other administrator can sign in.
 */
export async function updateAdminUser(
  services: UpdateServices,
  update: UserUpdate,
): Promise<ApiResponse<AdminUserDto>> {
  const { emailChange, logger } = services;
  const plan = await planUpdate(services, update);
  try {
    const { saved, lastActiveAt } = await services.runner.run(async (work) => {
      const saved = await saveUpdate(services, update, plan, work);
      const activity = await services.accounts.lastActiveFor([saved.id], work);
      return { saved, lastActiveAt: activity.get(saved.id) ?? null };
    });
    if (plan.pendingEmail !== undefined) {
      emailChange.notifyPreviousAddress({
        email: plan.target.email,
        locale: saved.locale,
      });
      await emailChange.sendConfirmation(
        saved,
        update.actorRole,
        update.actorId,
      );
    }
    logger.log(`User ${update.id} updated by ${update.actorId}`);
    return ApiResponse.success(
      mapToAdminUserDto(saved, lastActiveAt),
      'User updated successfully',
    );
  } catch (error) {
    rethrowOrUnavailable(error);
  }
}

async function planUpdate(
  services: UpdateServices,
  update: UserUpdate,
): Promise<PlannedUpdate> {
  const { access, emailChange } = services;
  const { id, dto, actorId, actorRole, actorPermissions } = update;
  const target = await access.loadActiveUser(id);
  access.assertTargetScope(
    USER_SCOPE_ACTION.UPDATE,
    target.audience,
    actorPermissions,
  );
  access.assertNotSelf(
    id,
    actorId,
    'Cannot modify your own account through admin panel',
  );
  const name = dto.name !== target.name ? dto.name : undefined;
  const pendingEmail =
    dto.email && dto.email !== target.email ? dto.email : undefined;
  const peer = isAdminRole(target.role) && isAdminRole(actorRole);
  if (peer && (name !== undefined || pendingEmail === undefined)) {
    throw peerRefusal();
  }
  if (!peer) await access.assertCanModify(actorRole, target.role);
  if (pendingEmail !== undefined) {
    await emailChange.assertAddressAvailable(pendingEmail, actorRole, id);
  }
  return { target, name, pendingEmail, peer };
}

async function saveUpdate(
  services: UpdateServices,
  update: UserUpdate,
  plan: PlannedUpdate,
  work: UnitOfWork,
): Promise<StoredAccount> {
  const { accounts, policy, events, lastAdmin } = services;
  const { session, dto } = update;
  if (plan.peer) {
    await policy.assertAct(work, session);
    await lastAdmin.lock(work);
  } else if (plan.pendingEmail !== undefined) {
    await policy.assertRouteProof(work, session);
  }
  const current = plan.peer
    ? await loadPeerTarget(services, work, update)
    : await loadAuthorizedUser(
        accounts,
        services.access,
        work,
        update.id,
        update.actorId,
        undefined,
        { requireAdmin: plan.pendingEmail !== undefined },
      );
  policy.assertVersion(dto.version, current.version);
  if (
    plan.pendingEmail !== undefined &&
    (current.email !== plan.target.email ||
      current.addressGeneration !== plan.target.addressGeneration)
  ) {
    throw new AppException(
      ErrorCode.CONFLICT,
      'The email address changed while this edit was prepared',
      HttpStatus.CONFLICT,
    );
  }
  // The target cannot sign in until it confirms, so another administrator must.
  if (plan.peer) await lastAdmin.assertOthersCanSignIn(work, [current.id]);
  if (plan.pendingEmail !== undefined) {
    await services.emailChange.claimPendingIn(work, current, plan.pendingEmail);
  }
  const saved = await accounts.saveIdentity(work, current, {
    name: plan.name,
    address:
      plan.pendingEmail === undefined
        ? undefined
        : {
            email: plan.pendingEmail,
            addressGeneration: current.addressGeneration + 1,
          },
  });
  await events.record(work, {
    action: SECURITY_EVENT_ACTION.ACCOUNT_UPDATED,
    actorId: update.actorId,
    targetUserId: saved.id,
    clientId: session?.clientId,
    details: updateDetails(plan),
  });
  return saved;
}

function updateDetails(plan: PlannedUpdate): Record<string, string | string[]> {
  return {
    changedFields: [
      ...(plan.name === undefined ? [] : ['name']),
      ...(plan.pendingEmail === undefined ? [] : ['email']),
    ],
    ...(plan.name === undefined ? {} : { name: plan.name }),
    ...(plan.pendingEmail === undefined ? {} : { email: plan.pendingEmail }),
  };
}
