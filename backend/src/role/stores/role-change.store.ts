import { UnitOfWork } from '../../common/persistence/unit-of-work';
import {
  HolderMove,
  HolderRevocation,
  MovedHolders,
  NewCustomRole,
  PendingSweep,
  RoleActorRecord,
  RoleDeletionRecord,
  RoleEdit,
  StoredRole,
} from './role-records';

/**
 * What creating, editing and deleting a role need. Every method takes part in
 * the caller's unit of work, so none can commit on its own.
 *
 * Taking a role: once `saveRoleEdit`, `savePendingSweeps` or `removeRole` has
 * returned, no other unit of work can change that role until this one ends. An
 * adapter may take it earlier, at `takeRoleForChange`. A second unit of work
 * that reaches a taken role is refused at once with a retryable abort.
 *
 * Moving holders: once `moveHolders` has returned, no other unit of work can
 * change those accounts' role or session version until this one ends, and a
 * second one that reaches them is refused the same way.
 */
export abstract class RoleChangeStore {
  abstract readActor(
    unitOfWork: UnitOfWork,
    actorId: string,
  ): Promise<RoleActorRecord | null>;
  abstract readRole(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<StoredRole | null>;
  abstract readRoleBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<StoredRole | null>;
  /** Holds the role's grant authority through this unit of work. */
  abstract readRoleAuthorityBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<StoredRole | null>;
  /** Reads the role this unit of work is about to edit or delete. */
  abstract takeRoleForChange(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<StoredRole | null>;
  abstract insertCustomRole(
    unitOfWork: UnitOfWork,
    role: NewCustomRole,
  ): Promise<StoredRole>;
  /** Writes the named fields of a role read earlier in this unit of work. */
  abstract saveRoleEdit(
    unitOfWork: UnitOfWork,
    roleId: string,
    edit: RoleEdit,
  ): Promise<StoredRole>;
  /** Replaces the repairs a role read earlier in this unit of work owes. */
  abstract savePendingSweeps(
    unitOfWork: UnitOfWork,
    ownerRoleId: string,
    sweeps: PendingSweep[],
  ): Promise<void>;
  abstract countHoldersInWork(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<number>;
  abstract appendRoleDeletion(
    unitOfWork: UnitOfWork,
    deletion: RoleDeletionRecord,
  ): Promise<void>;
  abstract removeRole(unitOfWork: UnitOfWork, roleId: string): Promise<void>;
  /**
   * Puts every holder of `fromSlugs` on `toSlug` and adds one to each session
   * version. Answers with the accounts it moved, so an account another unit of
   * work already moved is never revoked twice.
   */
  abstract moveHolders(
    unitOfWork: UnitOfWork,
    move: HolderMove,
  ): Promise<MovedHolders>;
  abstract appendHolderRevocations(
    unitOfWork: UnitOfWork,
    revocations: HolderRevocation[],
  ): Promise<void>;
}
