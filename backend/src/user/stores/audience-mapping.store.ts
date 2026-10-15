import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { RoleAudience } from '../../host/types/host-role.type';
import type {
  AudienceMappingAccount,
  AudienceMappingRole,
  AudienceMappingSnapshot,
  AudienceSnapshotOptions,
  MissingAudienceCounts,
} from '../types/audience-mapping';

/** Only the operator migration can fill an existing role's missing audience. */
export abstract class AudienceMappingStore {
  abstract missingCounts(work: UnitOfWork): Promise<MissingAudienceCounts>;
  /** Read-only by default; real mappings request locks for the inventory. */
  abstract snapshot(
    work: UnitOfWork,
    options?: AudienceSnapshotOptions,
  ): Promise<AudienceMappingSnapshot>;
  /** Refuses if the role changed or its audience is already set. */
  abstract mapRole(
    work: UnitOfWork,
    role: AudienceMappingRole,
    audience: RoleAudience,
  ): Promise<void>;
  /** Refuses if the account changed role or its audience is already set. */
  abstract mapAccount(
    work: UnitOfWork,
    account: AudienceMappingAccount,
    audience: RoleAudience,
  ): Promise<void>;
}
