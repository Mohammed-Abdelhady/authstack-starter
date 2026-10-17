import { Transaction } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RoleChangeStore } from '../../stores/role-change.store';
import {
  HolderMove,
  HolderRevocation,
  HolderSessionBump,
  MovedHolders,
  NewCustomRole,
  PendingSweep,
  RoleActorRecord,
  RoleDeletionRecord,
  RoleEdit,
  StoredRole,
} from '../../stores/role-records';
import {
  newSecurityEvent,
  roleDeletionEvent,
} from '../../../session/events/security-event-recorder';
import { SecurityEventStore } from '../../../session/events/security-event.store';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import { changeRoleHolderSessions } from './postgres-role-holders';
import {
  ROLE_COLUMNS,
  storedName,
  storedSlug,
  toStoredRoleOrNull,
} from './postgres-role-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

type Work = Transaction<PostgresTables>;

/** Replaces the repairs a role owes. The caller holds the role's row. */
export async function replacePendingSweeps(
  work: Work,
  ownerRoleId: string,
  sweeps: PendingSweep[],
): Promise<void> {
  await work
    .deleteFrom('role_pending_sweeps')
    .where('owner_role_id', '=', ownerRoleId)
    .execute();
  if (sweeps.length === 0) return;
  await work
    .insertInto('role_pending_sweeps')
    .values(
      sweeps.map((sweep) => ({
        owner_role_id: ownerRoleId,
        role_id: toUuid(sweep.roleId),
        previous_slug: sweep.previousSlug,
        actor_id: sweep.actorId,
        sweep_id: sweep.sweepId ?? null,
      })),
    )
    .execute();
}

/**
 * Takes a role at `takeRoleForChange` with a row lock, and the holders at
 * `moveHolders` before their version is written. A second unit of work is
 * refused at either at once (`NOWAIT`), which the runner reports as a retryable
 * abort. The lock is `FOR NO KEY UPDATE`, the strength sign-in takes on an
 * account, so a sign-in and a role change cannot both write one account.
 */
export class PostgresRoleChangeStore extends RoleChangeStore {
  constructor(
    private readonly clock: { now(): Date },
    private readonly events: SecurityEventStore,
  ) {
    super();
  }

  async readActor(
    unitOfWork: UnitOfWork,
    actorId: string,
  ): Promise<RoleActorRecord | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select(['is_deleted', 'role', 'permissions'])
      .where('id', '=', toUuid(actorId))
      .forShare()
      .noWait()
      .executeTakeFirst();
    if (!row) return null;
    return {
      isDeleted: row.is_deleted,
      roleSlug: row.role,
      permissions: row.permissions,
    };
  }

  async readRole(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<StoredRole | null> {
    const work = postgresTransactionOf(unitOfWork);
    const row = await work
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('id', '=', toUuid(roleId))
      .executeTakeFirst();
    return toStoredRoleOrNull(work, row);
  }

  async readRoleBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<StoredRole | null> {
    const work = postgresTransactionOf(unitOfWork);
    const row = await work
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('slug', '=', slug)
      .executeTakeFirst();
    return toStoredRoleOrNull(work, row);
  }

  async readRoleAuthorityBySlug(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<StoredRole | null> {
    const work = postgresTransactionOf(unitOfWork);
    const row = await work
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('slug', '=', slug)
      .forShare()
      .noWait()
      .executeTakeFirst();
    return toStoredRoleOrNull(work, row);
  }

  async takeRoleForChange(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<StoredRole | null> {
    const work = postgresTransactionOf(unitOfWork);
    const row = await work
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('id', '=', toUuid(roleId))
      .forNoKeyUpdate()
      .noWait()
      .executeTakeFirst();
    return toStoredRoleOrNull(work, row);
  }

  async insertCustomRole(
    unitOfWork: UnitOfWork,
    role: NewCustomRole,
  ): Promise<StoredRole> {
    const work = postgresTransactionOf(unitOfWork);
    const now = this.clock.now();
    const row = await work
      .insertInto('roles')
      .values({
        name: storedName(role.name),
        slug: storedSlug(role.slug),
        description: role.description?.trim() ?? null,
        is_system_role: false,
        is_protected: false,
        level: role.level,
        permissions: role.permissions,
        audience: role.audience ?? null,
        created_at: now,
        updated_at: now,
      })
      .returning(ROLE_COLUMNS)
      .executeTakeFirstOrThrow();
    return this.stored(work, row.id);
  }

  async saveRoleEdit(
    unitOfWork: UnitOfWork,
    roleId: string,
    edit: RoleEdit,
  ): Promise<StoredRole> {
    const work = postgresTransactionOf(unitOfWork);
    const id = toUuid(roleId);
    const fields = {
      ...(edit.name === undefined ? {} : { name: storedName(edit.name) }),
      ...(edit.slug === undefined ? {} : { slug: storedSlug(edit.slug) }),
      ...(edit.description === undefined
        ? {}
        : { description: edit.description.trim() }),
      ...(edit.level === undefined ? {} : { level: edit.level }),
      ...(edit.permissions === undefined
        ? {}
        : { permissions: edit.permissions }),
    };
    const changed =
      Object.keys(fields).length > 0 || edit.pendingHolderSweeps !== undefined;
    if (changed) {
      await work
        .updateTable('roles')
        .set({ ...fields, updated_at: this.clock.now() })
        .where('id', '=', id)
        .execute();
    }
    if (edit.pendingHolderSweeps !== undefined) {
      await replacePendingSweeps(work, id, edit.pendingHolderSweeps);
    }
    return this.stored(work, id);
  }

  async savePendingSweeps(
    unitOfWork: UnitOfWork,
    ownerRoleId: string,
    sweeps: PendingSweep[],
  ): Promise<void> {
    const work = postgresTransactionOf(unitOfWork);
    const id = toUuid(ownerRoleId);
    await work
      .selectFrom('roles')
      .select('id')
      .where('id', '=', id)
      .forNoKeyUpdate()
      .noWait()
      .execute();
    await work
      .updateTable('roles')
      .set({ updated_at: this.clock.now() })
      .where('id', '=', id)
      .execute();
    await replacePendingSweeps(work, id, sweeps);
  }

  async countHoldersInWork(
    unitOfWork: UnitOfWork,
    slug: string,
  ): Promise<number> {
    const counted = await postgresTransactionOf(unitOfWork)
      .selectFrom('users')
      .select((user) => user.fn.countAll<string>().as('total'))
      .where('role', '=', slug)
      .executeTakeFirstOrThrow();
    return Number.parseInt(counted.total, 10);
  }

  async appendRoleDeletion(
    unitOfWork: UnitOfWork,
    deletion: RoleDeletionRecord,
  ): Promise<void> {
    await this.events.append(
      unitOfWork,
      roleDeletionEvent(deletion, this.clock.now()),
    );
  }

  async removeRole(unitOfWork: UnitOfWork, roleId: string): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .deleteFrom('roles')
      .where('id', '=', toUuid(roleId))
      .execute();
  }

  moveHolders(unitOfWork: UnitOfWork, move: HolderMove): Promise<MovedHolders> {
    return changeRoleHolderSessions(postgresTransactionOf(unitOfWork), move);
  }

  bumpHolderSessions(
    unitOfWork: UnitOfWork,
    bump: HolderSessionBump,
  ): Promise<MovedHolders> {
    return changeRoleHolderSessions(postgresTransactionOf(unitOfWork), bump);
  }

  async appendHolderRevocations(
    unitOfWork: UnitOfWork,
    revocations: HolderRevocation[],
  ): Promise<void> {
    const occurredAt = this.clock.now();
    await this.events.appendMany(
      unitOfWork,
      revocations.map((revocation) => newSecurityEvent(revocation, occurredAt)),
    );
  }

  private async stored(work: Work, roleId: string): Promise<StoredRole> {
    const row = await work
      .selectFrom('roles')
      .select(ROLE_COLUMNS)
      .where('id', '=', roleId)
      .executeTakeFirstOrThrow();
    const role = await toStoredRoleOrNull(work, row);
    if (!role) {
      throw new Error('the role vanished inside its own unit of work');
    }
    return role;
  }
}
