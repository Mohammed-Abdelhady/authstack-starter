import { sql } from 'kysely';
import { RetryableAbortError } from '../../../common/persistence/persistence-errors';
import {
  PostgresUnitOfWorkRunner,
  postgresTransactionOf,
} from '../../../common/persistence/postgres/postgres-unit-of-work';
import { FrozenClock, TEST_NOW } from '../../../../test/utils/frozen-clock';
import {
  openTestConnection,
  TestConnection,
} from '../../../../test/postgres/postgres-connection';
import {
  POSTGRES_BOOT_TIMEOUT_MS,
  POSTGRES_RESET_TIMEOUT_MS,
  POSTGRES_TEARDOWN_TIMEOUT_MS,
} from '../../../../test/postgres/server/postgres-test-server';
import { RaceGate } from '../../../../test/utils/race-gate';
import { PostgresSecurityEventStore } from '../../../session/persistence/postgres/postgres-security-event.store';
import {
  ROLE_PERMISSIONS,
  USER_PERMISSIONS,
} from '../../../common/constants/permissions';
import { assertActorHoldsRole } from '../../../admin/services/roles/admin-grant-ceiling';
import { createRoleWithinCeiling } from '../../utils/role-create.util';
import { PostgresRoleChangeStore } from './postgres-role-change.store';

const GRANTED_PERMISSION = 'posts:write:all';
const HELD_PERMISSION = 'posts:read:all';

describe('PostgreSQL grant authority commit ordering', () => {
  let connection: TestConnection;

  beforeAll(async () => {
    connection = await openTestConnection();
  }, POSTGRES_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await connection?.close();
  }, POSTGRES_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    await connection.reset();
    await sql`INSERT INTO roles (name, slug, level, permissions, created_at, updated_at)
      VALUES ('Manager', 'manager', 3, ARRAY[]::text[], ${TEST_NOW}, ${TEST_NOW}),
             ('Support', 'support', 2, ARRAY[${HELD_PERMISSION}], ${TEST_NOW}, ${TEST_NOW})`.execute(
      connection.database,
    );
  }, POSTGRES_RESET_TIMEOUT_MS);

  function stores() {
    return {
      runner: new PostgresUnitOfWorkRunner(connection.database),
      store: new PostgresRoleChangeStore(
        new FrozenClock(TEST_NOW),
        new PostgresSecurityEventStore(connection.database),
      ),
    };
  }

  it('refuses a role grant while the actor permission revoke holds its row', async () => {
    const actor = await connection.database
      .insertInto('users')
      .values({
        role: 'manager',
        permissions: [ROLE_PERMISSIONS.CREATE_ALL, GRANTED_PERMISSION],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const gate = new RaceGate();
    const revoke = connection.database.transaction().execute(async (work) => {
      await work
        .updateTable('users')
        .set({ permissions: [ROLE_PERMISSIONS.CREATE_ALL] })
        .where('id', '=', actor.id)
        .execute();
      await gate.hold();
    });
    try {
      await gate.reached();
      await expect(
        createRoleWithinCeiling(
          stores(),
          { name: 'New Writer', permissions: [GRANTED_PERMISSION] },
          'new-writer',
          actor.id,
        ),
      ).rejects.toBeInstanceOf(RetryableAbortError);
    } finally {
      gate.release();
      await revoke;
    }
    expect(
      await connection.database
        .selectFrom('roles')
        .select('id')
        .where('slug', '=', 'new-writer')
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it('refuses assignment while a role permission edit holds that role', async () => {
    const actor = await connection.database
      .insertInto('users')
      .values({
        role: 'manager',
        permissions: [USER_PERMISSIONS.CREATE_ALL, HELD_PERMISSION],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const gate = new RaceGate();
    const edit = connection.database.transaction().execute(async (work) => {
      await work
        .updateTable('roles')
        .set({ permissions: [HELD_PERMISSION, GRANTED_PERMISSION] })
        .where('slug', '=', 'support')
        .execute();
      await gate.hold();
    });
    try {
      await gate.reached();
      const { runner, store } = stores();
      await expect(
        runner.run(async (work) => {
          await assertActorHoldsRole(
            store,
            work,
            actor.id,
            USER_PERMISSIONS.CREATE_ALL,
            'support',
          );
          await postgresTransactionOf(work)
            .insertInto('users')
            .values({ role: 'support', name: 'Assigned' })
            .execute();
        }),
      ).rejects.toBeInstanceOf(RetryableAbortError);
    } finally {
      gate.release();
      await edit;
    }
    expect(
      await connection.database
        .selectFrom('users')
        .select('id')
        .where('name', '=', 'Assigned')
        .executeTakeFirst(),
    ).toBeUndefined();
  });

  it('commits grants to unrelated roles from one actor', async () => {
    const actor = await connection.database
      .insertInto('users')
      .values({
        role: 'manager',
        permissions: [ROLE_PERMISSIONS.CREATE_ALL, GRANTED_PERMISSION],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { runner, store } = stores();
    await Promise.all([
      createRoleWithinCeiling(
        { runner, store },
        { name: 'First Writer', permissions: [GRANTED_PERMISSION] },
        'first-writer',
        actor.id,
      ),
      createRoleWithinCeiling(
        { runner, store },
        { name: 'Second Writer', permissions: [GRANTED_PERMISSION] },
        'second-writer',
        actor.id,
      ),
    ]);
    const roles = await connection.database
      .selectFrom('roles')
      .select('slug')
      .where('slug', 'in', ['first-writer', 'second-writer'])
      .orderBy('slug')
      .execute();
    expect(roles.map((role) => role.slug)).toEqual([
      'first-writer',
      'second-writer',
    ]);
  });
});
