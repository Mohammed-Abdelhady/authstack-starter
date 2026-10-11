import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../../role/stores/role-change.store';
import {
  assertCanGrant,
  assertFreshRolePermission,
} from '../../../role/utils/role-actor.util';

/**
 * The role ceiling for what an admin route hands to an account. The acting
 * account is read again inside the unit of work, must still hold the route's
 * own permission, and must hold every permission it hands out.
 *
 * @throws AppException FORBIDDEN on the first permission the actor lacks
 */
export async function assertActorHolds(
  store: RoleChangeStore,
  unitOfWork: UnitOfWork,
  actorId: string,
  routePermission: string,
  permissions: string[],
): Promise<void> {
  const actor = await assertFreshRolePermission(
    store,
    unitOfWork,
    actorId,
    routePermission,
  );
  assertCanGrant(actor, permissions);
}

/** The same ceiling for a role: the actor must hold all the role carries. */
export async function assertActorHoldsRole(
  store: RoleChangeStore,
  unitOfWork: UnitOfWork,
  actorId: string,
  routePermission: string,
  roleSlug: string,
): Promise<void> {
  const role = await store.readRoleBySlug(unitOfWork, roleSlug);
  await assertActorHolds(
    store,
    unitOfWork,
    actorId,
    routePermission,
    role?.permissions ?? [],
  );
}
