import { HttpStatus, Logger } from '@nestjs/common';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
import {
  ROLE_HOLDER_SWEEP_PASSES,
  ROLE_SWEEP_SLUG_REUSED,
} from '../../common/constants/roles';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { REVOKED_REASON } from '../../session/constants/revoked-reason';
import { SECURITY_EVENT_ACTION } from '../../session/constants/security-event-action';
import { UserRole } from '../../user/enums/user-role.enum';
import { RoleChangeStore } from '../stores/role-change.store';
import { HolderMove, StoredRole } from '../stores/role-records';
import { RoleSweepStore } from '../stores/role-sweep.store';

export interface RoleSweepStores {
  runner: UnitOfWorkRunner;
  changes: RoleChangeStore;
  sweeps: RoleSweepStore;
}

/**
 * Move holders onto a slug and end their sessions, in the caller's unit of
 * work. One revocation event is recorded per account the store really moved.
 */
export async function moveRoleHolders(
  changes: Pick<RoleChangeStore, 'moveHolders' | 'appendHolderRevocations'>,
  unitOfWork: UnitOfWork,
  move: HolderMove & { actorId: string },
): Promise<number> {
  const { actorId, ...holders } = move;
  const moved = await changes.moveHolders(unitOfWork, holders);
  if (moved.holderIds.length === 0) return 0;
  await changes.appendHolderRevocations(
    unitOfWork,
    moved.holderIds.map((targetUserId) => ({
      targetUserId,
      actorId,
      action: SECURITY_EVENT_ACTION.SESSIONS_REVOKED_ALL,
      reasonCode: REVOKED_REASON.ADMIN_FORCED,
    })),
  );
  return moved.moved;
}

export interface RoleHolderSweep {
  roleId: string;
  previousSlug: string;
  actorId: string;
  logger: Logger;
  fenceDestination?: boolean;
  onMoved?: (count: number) => void;
  userId?: string;
  previousRoleId?: string;
}

interface SweepPass {
  count: number;
  destinations: string[];
  reused: boolean;
}

const NOTHING_MOVED: SweepPass = { count: 0, destinations: [], reused: false };

async function sweepPass(
  { changes, sweeps }: RoleSweepStores,
  unitOfWork: UnitOfWork,
  input: RoleHolderSweep,
  sources: Set<string>,
): Promise<SweepPass> {
  const { roleId, previousSlug, actorId } = input;
  const liveRole = await changes.readRole(unitOfWork, roleId);
  const reused = await changes.readRoleBySlug(unitOfWork, previousSlug);
  if (reused && reused.id !== roleId) {
    return { count: 0, destinations: [], reused: true };
  }
  const stale = await sweeps.listStrandedHolders(unitOfWork, [...sources]);
  if (stale.length === 0) return NOTHING_MOVED;
  const fallback =
    liveRole ?? (await changes.readRoleBySlug(unitOfWork, UserRole.USER));
  const groups = new Map<string, { role: StoredRole; ids: string[] }>();
  const restorePreviousRoles = !liveRole;
  const deletion = !liveRole
    ? await sweeps.readDeletionRecord(unitOfWork, roleId)
    : null;
  const pendingActor =
    !liveRole && !deletion
      ? await sweeps.findPendingSweepActor(unitOfWork, roleId, previousSlug)
      : null;
  const restoreActor = deletion?.actorId ?? pendingActor ?? actorId;
  const previous = restorePreviousRoles
    ? await sweeps.readPreviousRoles(
        unitOfWork,
        stale.map((holder) => holder.id),
        roleId,
      )
    : new Map<string, string>();
  const restoredRoles = new Map<string, StoredRole | null>();
  for (const holder of stale) {
    const restoreId =
      previous.get(holder.id) ??
      (holder.id === input.userId ? input.previousRoleId : undefined);
    let destination: StoredRole | null = fallback;
    if (restorePreviousRoles && restoreId) {
      if (!restoredRoles.has(restoreId)) {
        restoredRoles.set(
          restoreId,
          await changes.readRole(unitOfWork, restoreId),
        );
      }
      destination = restoredRoles.get(restoreId) ?? fallback;
    }
    if (!destination)
      throw new AppException(
        ErrorCode.ROLE_NOT_FOUND,
        'Default role does not exist',
        HttpStatus.NOT_FOUND,
      );
    const group = groups.get(destination.slug) ?? {
      role: destination,
      ids: [],
    };
    group.ids.push(holder.id);
    groups.set(destination.slug, group);
  }
  let count = 0;
  for (const group of groups.values()) {
    // Only the role-edit sweep fences its destination. Assignment repair
    // never writes a role, so concurrent callers share one bulk move.
    if (input.fenceDestination) {
      await sweeps.fenceDestination(unitOfWork, group.role.id);
    }
    count += await moveRoleHolders(changes, unitOfWork, {
      fromSlugs: stale.map((holder) => holder.role),
      holderIds: group.ids,
      toSlug: group.role.slug,
      actorId: restoreActor,
    });
  }
  return { count, destinations: [...groups.keys()], reused: false };
}

/**
 * Put every account left on a slug no role carries onto a live role, one unit
 * of work per pass.
 *
 * @throws AppException AUTHORITY_UNAVAILABLE when holders remain after the last pass
 */
export async function sweepRoleHolders(
  stores: RoleSweepStores,
  input: RoleHolderSweep,
): Promise<number> {
  const { roleId, previousSlug, actorId } = input;
  let moved = 0;
  const sources = new Set([previousSlug]);
  // Assignment reconciliation and this sweep cover both commit orders.
  // A crash between assignment commit and reconciliation can still leave a stale slug.
  for (let pass = 0; pass < ROLE_HOLDER_SWEEP_PASSES; pass += 1) {
    const outcome = await stores.runner.run((unitOfWork) =>
      sweepPass(stores, unitOfWork, input, sources),
    );
    moved += outcome.count;
    input.onMoved?.(outcome.count);
    for (const slug of outcome.destinations) sources.add(slug);
    if (outcome.reused) {
      input.logger.warn({
        event: ROLE_SWEEP_SLUG_REUSED,
        roleId,
        previousSlug,
        actorId,
      });
    }
    if (outcome.count === 0) return moved;
  }
  const remaining = await stores.sweeps.listStrandedHoldersCommitted([
    ...sources,
  ]);
  if (remaining.length === 0) return moved;
  throw new AppException(
    ErrorCode.AUTHORITY_UNAVAILABLE,
    'Role holder reconciliation did not finish',
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
