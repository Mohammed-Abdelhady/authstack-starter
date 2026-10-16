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
    const saved = await services.runner.run((work) =>
      saveUpdate(services, update, plan, work),
    );
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
      mapToAdminUserDto(saved),
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

/** The target and the acting administrator, both read again under the roster lock. */
async function loadPeerTarget(
  services: UpdateServices,
  work: UnitOfWork,
  update: UserUpdate,
): Promise<StoredAccount> {
  const { accounts, access } = services;
  const current = await accounts.takeAccountForChange(work, update.id);
  if (!current || current.isDeleted) {
    throw new AppException(
      ErrorCode.USER_NOT_FOUND,
      'User not found',
      HttpStatus.NOT_FOUND,
    );
  }
  const actor = await accounts.readAccount(work, update.actorId);
  if (!actor || actor.isDeleted) {
    throw new AppException(
      ErrorCode.SESSION_INVALID,
      'Actor is no longer active',
      HttpStatus.UNAUTHORIZED,
    );
  }
  if (!isAdminRole(current.role) || !isAdminRole(actor.role)) {
    throw peerRefusal();
  }
  await access.assertTargetScopeInWork(
    work,
    actor.id,
    current.audience,
    USER_SCOPE_ACTION.UPDATE,
  );
  return current;
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

function peerRefusal(): AppException {
  return new AppException(
    ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    'Cannot modify user with higher or equal role',
    HttpStatus.FORBIDDEN,
  );
}
