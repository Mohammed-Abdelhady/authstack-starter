import type { RoleAudience } from '../../host/types/host-role.type';
import type {
  AudienceMappingAccount,
  AudienceMappingRole,
} from '../../user/types/audience-mapping';

export interface AudienceApplyOptions {
  dryRun: boolean;
  roles: ReadonlyMap<string, RoleAudience>;
}

export interface AudienceMappingPlan {
  roles: Array<{ role: AudienceMappingRole; audience: RoleAudience }>;
  accounts: Array<{ account: AudienceMappingAccount; audience: RoleAudience }>;
}

export interface AudienceApplySummary {
  dryRun: boolean;
  roles: number;
  accounts: number;
  revokedSessions: number;
}
