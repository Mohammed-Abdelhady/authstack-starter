import type { RoleAudience } from '../../host/types/host-role.type';
/** Shared names of the unique rules a role write can run into. */
export const ROLE_CONSTRAINT = {
  SLUG: 'role.slug',
} as const;

/** A repair still owed: holders of `previousSlug` have to follow role `roleId`. */
export interface PendingSweep {
  roleId: string;
  previousSlug: string;
  actorId: string;
  sweepId?: string;
}

export interface StoredRole {
  audience?: RoleAudience;
  id: string;
  name: string;
  slug: string;
  description?: string;
  isSystemRole: boolean;
  isProtected: boolean;
  level?: number;
  permissions: string[];
  pendingHolderSweeps: PendingSweep[];
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCustomRole {
  audience?: RoleAudience;
  name: string;
  slug: string;
  description?: string;
  level: number;
  permissions: string[];
}

/** Only the fields named are written. */
export interface RoleEdit {
  name?: string;
  slug?: string;
  description?: string;
  level?: number;
  permissions?: string[];
  pendingHolderSweeps?: PendingSweep[];
}

/** The acting account as stored. Its role is read apart, by slug. */
export interface RoleActorRecord {
  isDeleted: boolean;
  roleSlug: string;
  permissions: string[];
}

export interface RoleListQuery {
  search?: string;
  page: number;
  limit: number;
}

export interface RoleListPage {
  roles: StoredRole[];
  total: number;
}

export interface HolderMove {
  audience?: RoleAudience;
  fromSlugs: string[];
  toSlug: string;
  /** Narrows the move to these accounts when given. */
  holderIds?: string[];
}

/** End sessions without changing any account's assigned role. */
export interface HolderSessionBump {
  fromSlugs: string[];
  /** Matching holders already moved and were revoked in the same edit. */
  excludingAudience?: RoleAudience;
}

export interface MovedHolders {
  holderIds: string[];
  moved: number;
}

export interface HolderRevocation {
  targetUserId: string;
  actorId: string;
  action: string;
  reasonCode: string;
}

export interface RoleDeletionRecord {
  roleId: string;
  previousSlug: string;
  actorId: string;
  sweepId?: string;
}

export interface StrandedHolder {
  audience?: RoleAudience;
  id: string;
  role: string;
}

export interface SweepOwner {
  id: string;
  pendingHolderSweeps: PendingSweep[];
}

/** The store's own rules refused the role's fields, for example a blank name. */
export class RoleFieldsRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'RoleFieldsRejectedError';
  }
}
