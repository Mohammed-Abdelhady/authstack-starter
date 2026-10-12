import { Kysely } from 'kysely';
import {
  PendingSweep,
  RoleFieldsRejectedError,
  StoredRole,
  SweepOwner,
} from '../../stores/role-records';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';

/** A connection or an open transaction: both read the same way. */
export type RoleReader = Kysely<PostgresTables>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidText(text: string): boolean {
  return UUID_PATTERN.test(text);
}

export const ROLE_COLUMNS = [
  'id',
  'name',
  'slug',
  'description',
  'is_system_role',
  'is_protected',
  'level',
  'permissions',
  'created_at',
  'updated_at',
] as const;

export interface RoleRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_system_role: boolean;
  is_protected: boolean;
  level: number | null;
  permissions: string[];
  created_at: Date;
  updated_at: Date;
}

interface PendingSweepRow {
  owner_role_id: string;
  role_id: string;
  previous_slug: string;
  actor_id: string;
  sweep_id: string | null;
}

export function toPendingSweep(row: PendingSweepRow): PendingSweep {
  return {
    roleId: row.role_id,
    previousSlug: row.previous_slug,
    actorId: row.actor_id,
    ...(row.sweep_id === null ? {} : { sweepId: row.sweep_id }),
  };
}

function toStoredRole(row: RoleRow, owed: PendingSweep[]): StoredRole {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? undefined,
    isSystemRole: row.is_system_role,
    isProtected: row.is_protected,
    level: row.level ?? undefined,
    permissions: row.permissions,
    pendingHolderSweeps: owed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The repairs each role owes, in the order they were recorded. */
export async function pendingSweepsOf(
  reader: RoleReader,
  ownerIds: string[],
): Promise<Map<string, PendingSweep[]>> {
  const owed = new Map<string, PendingSweep[]>();
  if (ownerIds.length === 0) return owed;
  const rows = await reader
    .selectFrom('role_pending_sweeps')
    .select([
      'owner_role_id',
      'role_id',
      'previous_slug',
      'actor_id',
      'sweep_id',
    ])
    .where('owner_role_id', 'in', ownerIds)
    .orderBy('id')
    .execute();
  for (const row of rows) {
    const list = owed.get(row.owner_role_id) ?? [];
    list.push(toPendingSweep(row));
    owed.set(row.owner_role_id, list);
  }
  return owed;
}

export async function toStoredRoles(
  reader: RoleReader,
  rows: RoleRow[],
): Promise<StoredRole[]> {
  const owed = await pendingSweepsOf(
    reader,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toStoredRole(row, owed.get(row.id) ?? []));
}

export async function toStoredRoleOrNull(
  reader: RoleReader,
  row: RoleRow | undefined,
): Promise<StoredRole | null> {
  if (!row) return null;
  const [role] = await toStoredRoles(reader, [row]);
  return role;
}

export async function toSweepOwners(
  reader: RoleReader,
  ownerIds: string[],
): Promise<SweepOwner[]> {
  const owed = await pendingSweepsOf(reader, ownerIds);
  return ownerIds.map((id) => ({
    id,
    pendingHolderSweeps: owed.get(id) ?? [],
  }));
}

/** The stored form of a name. A blank one is refused, as the document rules do. */
export function storedName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new RoleFieldsRejectedError('Role name is required');
  }
  return trimmed;
}

export function storedSlug(slug: string): string {
  const normalized = slug.toLowerCase().trim();
  if (normalized === '') {
    throw new RoleFieldsRejectedError('Role slug is required');
  }
  return normalized;
}

/** Turns search text into a pattern that matches it literally, anywhere. */
export function containsPattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
