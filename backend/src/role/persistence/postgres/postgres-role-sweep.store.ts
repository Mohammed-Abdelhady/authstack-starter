import { Kysely, sql, Transaction } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  PendingSweep,
  RoleDeletionRecord,
  StrandedHolder,
  SweepOwner,
} from '../../stores/role-records';
import { RoleSweepStore } from '../../stores/role-sweep.store';
import { ROLE_DELETION_EVENT_PREFIX } from '../../../session/constants/security-event-action';
import { PostgresTables } from '../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../session/persistence/postgres/postgres-issuance-mappers';
import {
  containsPattern,
  isUuidText,
  RoleReader,
  toSweepOwners,
} from './postgres-role-mappers';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

type Work = Transaction<PostgresTables>;

function strandedHolders(
  reader: RoleReader,
  sources: string[],
): Promise<StrandedHolder[]> {
  if (sources.length === 0) return Promise.resolve([]);
  return reader
    .selectFrom('users')
    .select(['id', 'role'])
    .where('role', 'in', sources)
    .where((user) =>
      user.not(
        user.exists(
          user
            .selectFrom('roles')
            .select('roles.id')
            .whereRef('roles.slug', '=', 'users.role'),
        ),
      ),
    )
    .orderBy('id')
    .execute();
}

function deletionEventId(roleId: string): string {
  return `${ROLE_DELETION_EVENT_PREFIX}${roleId}`;
}

/** Waits for the owner's row, so a list change never interleaves with an edit. */
async function holdOwner(work: Work, ownerRoleId: string): Promise<boolean> {
  const owner = await work
    .selectFrom('roles')
    .select('id')
    .where('id', '=', ownerRoleId)
    .forNoKeyUpdate()
    .executeTakeFirst();
  return owner !== undefined;
}

/**
 * Fences a destination with the row lock an edit of that role takes, refused at
 * once when the role is already taken. Changes to the list of owed repairs
 * outside a unit of work wait for the owner's row instead.
 */
export class PostgresRoleSweepStore extends RoleSweepStore {
  constructor(
    private readonly database: Kysely<PostgresTables>,
    private readonly clock: { now(): Date },
  ) {
    super();
  }

  listStrandedHolders(
    unitOfWork: UnitOfWork,
    sources: string[],
  ): Promise<StrandedHolder[]> {
    return strandedHolders(postgresTransactionOf(unitOfWork), sources);
  }

  async readDeletionRecord(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<RoleDeletionRecord | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('security_events')
      .select([
        'actor_id',
        'deleted_role_id',
        'deleted_role_slug',
        'deletion_sweep_id',
      ])
      .where('event_id', '=', deletionEventId(toUuid(roleId)))
      .executeTakeFirst();
    if (!row || row.deleted_role_id === null) return null;
    return {
      roleId: row.deleted_role_id,
      previousSlug: row.deleted_role_slug ?? '',
      actorId: row.actor_id ?? '',
      ...(row.deletion_sweep_id === null
        ? {}
        : { sweepId: row.deletion_sweep_id }),
    };
  }

  async findPendingSweepActor(
    unitOfWork: UnitOfWork,
    roleId: string,
    previousSlug: string,
  ): Promise<string | null> {
    const row = await postgresTransactionOf(unitOfWork)
      .selectFrom('role_pending_sweeps')
      .select('actor_id')
      .where('role_id', '=', toUuid(roleId))
      .where('previous_slug', '=', previousSlug)
      .orderBy('id')
      .limit(1)
      .executeTakeFirst();
    return row?.actor_id ?? null;
  }

  async readPreviousRoles(
    unitOfWork: UnitOfWork,
    holderIds: string[],
    assignedRoleId: string,
  ): Promise<Map<string, string>> {
    const previous = new Map<string, string>();
    if (holderIds.length === 0) return previous;
    const assigned = toUuid(assignedRoleId);
    const rows = await postgresTransactionOf(unitOfWork)
      .selectFrom('security_events')
      .distinctOn('target_user_id')
      .select(['target_user_id', 'assigned_role_id', 'previous_role_id'])
      .where('target_user_id', 'in', holderIds.map(toUuid))
      .where('assigned_role_id', 'is not', null)
      .orderBy('target_user_id')
      .orderBy('assignment_session_version', 'desc')
      .orderBy('id', 'desc')
      .execute();
    for (const row of rows) {
      if (row.assigned_role_id !== assigned) continue;
      const roleId = row.previous_role_id;
      if (row.target_user_id && roleId && isUuidText(roleId)) {
        previous.set(row.target_user_id, roleId);
      }
    }
    return previous;
  }

  async fenceDestination(
    unitOfWork: UnitOfWork,
    roleId: string,
  ): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .selectFrom('roles')
      .select('id')
      .where('id', '=', toUuid(roleId))
      .forNoKeyUpdate()
      .noWait()
      .execute();
  }

  listStrandedHoldersCommitted(sources: string[]): Promise<StrandedHolder[]> {
    return strandedHolders(this.database, sources);
  }

  async clearPendingSweep(
    ownerRoleId: string,
    sweep: PendingSweep,
  ): Promise<void> {
    const owner = toUuid(ownerRoleId);
    const roleId = toUuid(sweep.roleId);
    await this.database.transaction().execute(async (work) => {
      if (!(await holdOwner(work, owner))) return;
      await work
        .deleteFrom('role_pending_sweeps')
        .where('owner_role_id', '=', owner)
        .where('role_id', '=', roleId)
        .where('previous_slug', '=', sweep.previousSlug)
        .where('actor_id', '=', sweep.actorId)
        .where(
          sql<boolean>`sweep_id IS NOT DISTINCT FROM ${sweep.sweepId ?? null}`,
        )
        .execute();
      await this.touch(work, owner);
    });
  }

  async recordPendingSweepIfRoom(
    ownerRoleId: string,
    sweep: PendingSweep,
    limit: number,
  ): Promise<void> {
    const owner = toUuid(ownerRoleId);
    const roleId = toUuid(sweep.roleId);
    await this.database.transaction().execute(async (work) => {
      if (!(await holdOwner(work, owner))) return;
      const owed = await work
        .selectFrom('role_pending_sweeps')
        .select(['role_id', 'previous_slug'])
        .where('owner_role_id', '=', owner)
        .execute();
      const recorded = owed.some(
        (row) =>
          row.role_id === roleId && row.previous_slug === sweep.previousSlug,
      );
      if (recorded || owed.length >= limit) return;
      await work
        .insertInto('role_pending_sweeps')
        .values({
          owner_role_id: owner,
          role_id: roleId,
          previous_slug: sweep.previousSlug,
          actor_id: sweep.actorId,
          sweep_id: sweep.sweepId ?? null,
        })
        .execute();
      await this.touch(work, owner);
    });
  }

  async completeDeletion(roleId: string): Promise<void> {
    await this.database
      .updateTable('security_events')
      .set({ deletion_pending: false })
      .where('event_id', '=', deletionEventId(toUuid(roleId)))
      .where('deletion_pending', '=', true)
      .execute();
  }

  async listSweepOwners(limit: number): Promise<SweepOwner[]> {
    const owners = await this.database
      .selectFrom('roles')
      .select('id')
      .where((role) =>
        role.exists(
          role
            .selectFrom('role_pending_sweeps')
            .select('role_pending_sweeps.id')
            .whereRef('role_pending_sweeps.owner_role_id', '=', 'roles.id'),
        ),
      )
      .orderBy('updated_at')
      .orderBy('id')
      .limit(limit)
      .execute();
    return toSweepOwners(
      this.database,
      owners.map((owner) => owner.id),
    );
  }

  async findSweepOwnerBySlug(slug: string): Promise<SweepOwner | null> {
    const role = await this.database
      .selectFrom('roles')
      .select('id')
      .where('slug', '=', slug)
      .executeTakeFirst();
    if (!role) return null;
    const [owner] = await toSweepOwners(this.database, [role.id]);
    return owner;
  }

  async rotateSweepOwner(ownerRoleId: string, at: Date): Promise<void> {
    await this.database
      .updateTable('roles')
      .set({ updated_at: at })
      .where('id', '=', toUuid(ownerRoleId))
      .where((role) =>
        role.exists(
          role
            .selectFrom('role_pending_sweeps')
            .select('role_pending_sweeps.id')
            .whereRef('role_pending_sweeps.owner_role_id', '=', 'roles.id'),
        ),
      )
      .execute();
  }

  async listPendingDeletions(limit: number): Promise<PendingSweep[]> {
    const rows = await this.database
      .selectFrom('security_events')
      .select([
        'actor_id',
        'deleted_role_id',
        'deleted_role_slug',
        'deletion_sweep_id',
      ])
      .where('event_id', 'like', startsWithPattern(ROLE_DELETION_EVENT_PREFIX))
      .where('deletion_pending', '=', true)
      .limit(limit)
      .execute();
    return rows.flatMap((row) =>
      row.deleted_role_id === null
        ? []
        : [
            {
              roleId: row.deleted_role_id,
              previousSlug: row.deleted_role_slug ?? '',
              actorId: row.actor_id ?? '',
              ...(row.deletion_sweep_id === null
                ? {}
                : { sweepId: row.deletion_sweep_id }),
            },
          ],
    );
  }

  private async touch(work: Work, ownerRoleId: string): Promise<void> {
    await work
      .updateTable('roles')
      .set({ updated_at: this.clock.now() })
      .where('id', '=', ownerRoleId)
      .execute();
  }
}

/** A pattern for text that starts with the prefix, taken literally. */
function startsWithPattern(prefix: string): string {
  return containsPattern(prefix).slice(1);
}
