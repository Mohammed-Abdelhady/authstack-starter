import { UnitOfWork } from '../../common/persistence/unit-of-work';
import {
  PendingSweep,
  RoleDeletionRecord,
  StrandedHolder,
  SweepOwner,
} from './role-records';

/**
 * What the holder repair needs beyond the role change store: finding accounts
 * left on a slug no role carries, and keeping the list of repairs still owed.
 */
export abstract class RoleSweepStore {
  /** Holders of `sources` whose slug no role carries, inside the unit of work. */
  abstract listStrandedHolders(
    unitOfWork: UnitOfWork,
    sources: string[],
  ): Promise<StrandedHolder[]>;
  abstract readDeletionRecord(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<RoleDeletionRecord | null>;
  /** Who asked for the repair of `previousSlug`, if a role still records it. */
  abstract findPendingSweepActor(
    unitOfWork: UnitOfWork,
    roleId: string,
    previousSlug: string,
  ): Promise<string | null>;
  /**
   * For each holder whose latest assignment put it on `assignedRoleId`, the id
   * of the role it held before. Holders without that history are left out.
   */
  abstract readPreviousRoles(
    unitOfWork: UnitOfWork,
    holderIds: string[],
    assignedRoleId: string,
  ): Promise<Map<string, string>>;
  /**
   * Takes the role holders are about to be moved onto, so an edit of that role
   * and this move cannot both commit. A taken role refuses with a retryable
   * abort.
   */
  abstract fenceDestination(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<void>;

  /** The same question as `listStrandedHolders`, read as committed state. */
  abstract listStrandedHoldersCommitted(
    sources: string[],
  ): Promise<StrandedHolder[]>;
  abstract clearPendingSweep(
    ownerRoleId: string,
    sweep: PendingSweep,
  ): Promise<void>;
  /** Records the repair unless the role already owes it or owes `limit`. */
  abstract recordPendingSweepIfRoom(
    ownerRoleId: string,
    sweep: PendingSweep,
    limit: number,
  ): Promise<void>;
  abstract completeDeletion(roleId: string): Promise<void>;
  /** Roles that owe a repair, the one updated longest ago first. */
  abstract listSweepOwners(limit: number): Promise<SweepOwner[]>;
  abstract findSweepOwnerBySlug(slug: string): Promise<SweepOwner | null>;
  /** Moves an owner that still owes a repair behind the others. */
  abstract rotateSweepOwner(ownerRoleId: string, at: Date): Promise<void>;
  abstract listPendingDeletions(limit: number): Promise<PendingSweep[]>;
}
