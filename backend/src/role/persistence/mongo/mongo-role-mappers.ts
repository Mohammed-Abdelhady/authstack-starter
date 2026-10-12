import { Types } from 'mongoose';
import { toObjectId } from '../../../session/persistence/mongo/mongo-issuance-mappers';
import { PendingRoleSweep } from './schemas/role.schema';
import {
  PendingSweep,
  StoredRole,
  SweepOwner,
} from '../../stores/role-records';

/** A role as Mongoose hands it over: a hydrated document or a lean object. */
export interface RoleFields {
  _id: { toString(): string };
  name: string;
  slug: string;
  description?: string;
  isSystemRole: boolean;
  isProtected: boolean;
  level?: number;
  permissions: string[];
  pendingHolderSweeps?: PendingRoleSweep[];
  createdAt: Date;
  updatedAt: Date;
}

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export function isObjectIdText(text: string): boolean {
  return OBJECT_ID_PATTERN.test(text);
}

export function toPendingSweep(stored: PendingRoleSweep): PendingSweep {
  return {
    roleId: stored.roleId.toString(),
    previousSlug: stored.previousSlug,
    actorId: stored.actorId,
    ...(stored.sweepId === undefined ? {} : { sweepId: stored.sweepId }),
  };
}

export function toPendingRoleSweep(sweep: PendingSweep): PendingRoleSweep {
  return {
    roleId: toObjectId(sweep.roleId),
    previousSlug: sweep.previousSlug,
    actorId: sweep.actorId,
    ...(sweep.sweepId === undefined ? {} : { sweepId: sweep.sweepId }),
  };
}

export function toStoredRole(role: RoleFields): StoredRole {
  return {
    id: role._id.toString(),
    name: role.name,
    slug: role.slug,
    description: role.description,
    isSystemRole: role.isSystemRole,
    isProtected: role.isProtected,
    level: role.level,
    permissions: [...role.permissions],
    pendingHolderSweeps: (role.pendingHolderSweeps ?? []).map(toPendingSweep),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

export function toSweepOwner(role: RoleFields): SweepOwner {
  return {
    id: role._id.toString(),
    pendingHolderSweeps: (role.pendingHolderSweeps ?? []).map(toPendingSweep),
  };
}

export function toObjectIds(ids: string[]): Types.ObjectId[] {
  return ids.map(toObjectId);
}
