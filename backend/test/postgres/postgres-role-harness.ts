import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { FrozenClock, TEST_NOW } from '../utils/frozen-clock';
import {
  issueOnlyTheRefusedEventId,
  REFUSED_EVENT_ID,
  REFUSED_EVENT_SEED_ACTION,
  REFUSED_EVENT_SEED_OUTCOME,
} from '../utils/refused-event';
import { RoleContractHarness } from '../utils/role/role-contract/role-contract-harness';
import { PostgresRoleCatalogStore } from '../../src/role/persistence/postgres/postgres-role-catalog.store';
import { PostgresRoleChangeStore } from '../../src/role/persistence/postgres/postgres-role-change.store';
import { PostgresRoleSweepStore } from '../../src/role/persistence/postgres/postgres-role-sweep.store';
import { PostgresSecurityEventStore } from '../../src/session/persistence/postgres/postgres-security-event.store';
import { PostgresUnitOfWorkRunner } from '../../src/common/persistence/postgres/postgres-unit-of-work';
import { openTestConnection } from './postgres-connection';

const AN_OBJECT_ID = '65f000000000000000000001';
const ASSIGNMENT_ACTION = 'test.role-assigned';

export async function bootPostgresRoleHarness(): Promise<RoleContractHarness> {
  const connection = await openTestConnection();
  const { database } = connection;
  const clock = new FrozenClock(TEST_NOW);
  let assignments = 0;

  return {
    clock,
    catalog: new PostgresRoleCatalogStore(database),
    changes: new PostgresRoleChangeStore(
      clock,
      new PostgresSecurityEventStore(database),
    ),
    sweeps: new PostgresRoleSweepStore(database, clock),
    runner: (pause) => new PostgresUnitOfWorkRunner(database, pause),

    alterRoleAudience: async (slug, audience) => {
      await sql`
        UPDATE roles SET audience = ${audience} WHERE slug = ${slug}
      `.execute(database);
    },
    seedRole: async (role) => {
      const at = role.createdAt ?? clock.now();
      const row = await database
        .insertInto('roles')
        .values({
          name: role.name,
          slug: role.slug,
          audience: role.audience ?? null,
          permissions: role.permissions,
          level: role.level ?? null,
          is_system_role: role.isSystemRole ?? false,
          is_protected: role.isProtected ?? false,
          created_at: at,
          updated_at: at,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    seedAccount: async (account) => {
      const row = await database
        .insertInto('users')
        .values({
          role: account.role,
          audience: account.audience ?? null,
          permissions: account.permissions ?? [],
          is_deleted: account.deleted ?? false,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    },
    seedAccounts: async (count, role) => {
      const rows = await database
        .insertInto('users')
        .columns(['role'])
        .expression(
          sql<{
            role: string;
          }>`SELECT ${role} FROM generate_series(1, ${count}::integer)`,
        )
        .returning('id')
        .execute();
      return rows.map((row) => row.id).sort();
    },
    interruptRename: async (roleId, rename) => {
      await database
        .updateTable('roles')
        .set({ name: rename.name, slug: rename.slug })
        .where('id', '=', roleId)
        .execute();
      await database
        .insertInto('role_pending_sweeps')
        .values({
          owner_role_id: roleId,
          role_id: roleId,
          previous_slug: rename.previousSlug,
          actor_id: rename.actorId,
          sweep_id: 'interrupted-rename',
        })
        .execute();
    },

    oweRepair: async (ownerRoleId, repair) => {
      await database
        .insertInto('role_pending_sweeps')
        .values({
          owner_role_id: ownerRoleId,
          role_id: repair.roleId,
          previous_slug: repair.previousSlug,
          actor_id: repair.actorId,
          sweep_id: repair.sweepId ?? null,
        })
        .execute();
    },
    seedAssignment: async (assignment) => {
      assignments += 1;
      await database
        .insertInto('security_events')
        .values({
          event_id: `role-contract-assignment-${assignments}`,
          target_user_id: assignment.userId,
          action: ASSIGNMENT_ACTION,
          outcome: 'succeeded',
          occurred_at: clock.now(),
          assigned_role_id: assignment.assignedRoleId,
          previous_role_id: assignment.previousRoleId ?? null,
          assignment_session_version: assignment.sessionVersion,
        })
        .execute();
    },

    role: async (slug) => {
      const row = await database
        .selectFrom('roles')
        .selectAll()
        .where('slug', '=', slug)
        .executeTakeFirst();
      if (!row) return null;
      const owed = await database
        .selectFrom('role_pending_sweeps')
        .select(['previous_slug', 'role_id'])
        .where('owner_role_id', '=', row.id)
        .orderBy('id')
        .execute();
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        ...(row.audience ? { audience: row.audience } : {}),
        description: row.description,
        level: row.level,
        permissions: row.permissions,
        isSystemRole: row.is_system_role,
        isProtected: row.is_protected,
        owedRepairs: owed.map(
          (repair) => `${repair.previous_slug} for ${repair.role_id}`,
        ),
      };
    },
    account: async (userId) => {
      const row = await database
        .selectFrom('users')
        .select(['role', 'session_version', 'audience'])
        .where('id', '=', userId)
        .executeTakeFirst();
      return row
        ? {
            role: row.role,
            sessionVersion: row.session_version,
            ...(row.audience ? { audience: row.audience } : {}),
          }
        : null;
    },
    events: async () => {
      const rows = await database
        .selectFrom('security_events')
        .select(['target_user_id', 'actor_id', 'action', 'reason_code'])
        .where('action', '!=', REFUSED_EVENT_SEED_ACTION)
        .execute();
      return rows.map((row) => ({
        targetUserId: row.target_user_id,
        actorId: row.actor_id,
        action: row.action,
        reasonCode: row.reason_code,
      }));
    },

    absentId: () => randomUUID(),
    foreignId: () => AN_OBJECT_ID,

    refuseSecurityEvents: async () => {
      await database
        .insertInto('security_events')
        .values({
          event_id: REFUSED_EVENT_ID,
          action: REFUSED_EVENT_SEED_ACTION,
          outcome: REFUSED_EVENT_SEED_OUTCOME,
          occurred_at: TEST_NOW,
        })
        .onConflict((conflict) => conflict.column('event_id').doNothing())
        .execute();
      return issueOnlyTheRefusedEventId();
    },

    reset: connection.reset,
    close: connection.close,
  };
}
