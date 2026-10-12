import { Logger } from '@nestjs/common';
import {
  ROLE_PENDING_SWEEP_LIMIT,
  ROLE_SWEEP_PENDING,
} from '../../common/constants/roles';
import { PendingSweep } from '../stores/role-records';
import { describeStoreFailure } from '../utils/role-failure.util';
import { RoleSweepStores, sweepRoleHolders } from './role-holder-sweep';

export interface PendingRoleRepair {
  ownerId: string;
  refs: PendingSweep[];
  logger: Logger;
  recorded?: boolean;
  shouldStop?: () => boolean;
}

/** Run each owed repair and clear it. A failed one is logged and stays owed. */
export async function repairPendingRoleSweeps(
  stores: RoleSweepStores,
  input: PendingRoleRepair,
): Promise<number> {
  let moved = 0;
  for (const ref of input.refs) {
    if (input.shouldStop?.()) break;
    try {
      await sweepRoleHolders(stores, {
        roleId: ref.roleId,
        previousSlug: ref.previousSlug,
        actorId: ref.actorId,
        logger: input.logger,
        fenceDestination: true,
        onMoved: (count) => {
          moved += count;
        },
      });
      if (input.recorded !== false)
        await stores.sweeps.clearPendingSweep(input.ownerId, ref);
      await stores.sweeps.completeDeletion(ref.roleId);
    } catch (error) {
      let pendingRecordError: unknown;
      if (input.recorded === false) {
        try {
          await stores.sweeps.recordPendingSweepIfRoom(
            input.ownerId,
            ref,
            ROLE_PENDING_SWEEP_LIMIT,
          );
        } catch (recordError) {
          pendingRecordError = recordError;
        }
      }
      // The role operation already committed. Its durable repair remains pending.
      input.logger.error({
        event: ROLE_SWEEP_PENDING,
        roleId: ref.roleId,
        previousSlug: ref.previousSlug,
        actorId: ref.actorId,
        error: describeStoreFailure(error),
        ...(pendingRecordError
          ? { pendingRecordError: describeStoreFailure(pendingRecordError) }
          : {}),
      });
    }
  }
  return moved;
}
