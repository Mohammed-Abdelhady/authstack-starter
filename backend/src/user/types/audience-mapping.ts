import type { RoleAudience } from '../../host/types/host-role.type';

export interface AudienceMappingRole {
  id: string;
  slug: string;
  audience?: RoleAudience;
  permissions: readonly string[];
}

export interface AudienceMappingAccount {
  id: string;
  role: string;
  audience?: RoleAudience;
  permissions: readonly string[];
}

export interface AudienceMappingSnapshot {
  roles: AudienceMappingRole[];
  accounts: AudienceMappingAccount[];
}

export interface MissingAudienceCounts {
  roles: number;
  accounts: number;
}

export interface AudienceSnapshotOptions {
  lock?: boolean;
}
