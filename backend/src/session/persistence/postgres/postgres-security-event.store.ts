import { Kysely, Selectable } from 'kysely';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import {
  NewSecurityEvent,
  SecurityEventStore,
  StoredSecurityEvent,
} from '../../events/security-event.store';
import {
  PostgresTables,
  SecurityEventsTable,
} from '../../../common/persistence/postgres/postgres-database';
import { autocommit } from '../../../auth/persistence/postgres/postgres-pending-codes-database';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { rowSlices } from './postgres-bind-parameters';

/** The constraint's shared name comes from the central table of the adapter. */
const NO_LOCAL_CONSTRAINTS = {};

const EVENT_COLUMNS = [
  'event_id',
  'actor_id',
  'target_user_id',
  'client_id',
  'session_id',
  'action',
  'reason_code',
  'request_id',
  'outcome',
  'occurred_at',
  'assigned_role_id',
  'previous_role_id',
  'assignment_session_version',
  'deleted_role_id',
  'deleted_role_slug',
  'deletion_sweep_id',
  'deletion_pending',
] as const;

type EventRow = Pick<
  Selectable<SecurityEventsTable>,
  (typeof EVENT_COLUMNS)[number]
>;

/**
 * A deletion's actor is the event's actor: the row has one column for both.
 * `purge_after` is left to the column's default, the database's own setting.
 */
function toRow(event: NewSecurityEvent): EventRow {
  const assignment = event.roleAssignment;
  const deletion = event.roleDeletionSweep;
  return {
    event_id: event.eventId,
    actor_id: event.actorId ?? null,
    target_user_id: event.targetUserId ?? null,
    client_id: event.clientId ?? null,
    session_id: event.sessionId ?? null,
    action: event.action,
    reason_code: event.reasonCode ?? null,
    request_id: event.requestId ?? null,
    outcome: event.outcome,
    occurred_at: event.occurredAt,
    assigned_role_id: assignment?.assignedRoleId ?? null,
    previous_role_id: assignment?.previousRoleId ?? null,
    assignment_session_version: assignment?.sessionVersion ?? null,
    deleted_role_id: deletion?.roleId ?? null,
    deleted_role_slug: deletion?.previousSlug ?? null,
    deletion_sweep_id: deletion?.sweepId ?? null,
    deletion_pending: deletion?.pending ?? null,
  };
}

function toStoredEvent(row: EventRow): StoredSecurityEvent {
  return {
    eventId: row.event_id,
    actorId: row.actor_id,
    targetUserId: row.target_user_id,
    clientId: row.client_id,
    sessionId: row.session_id,
    action: row.action,
    reasonCode: row.reason_code,
    requestId: row.request_id,
    outcome: row.outcome,
    occurredAt: row.occurred_at,
    roleAssignment:
      row.assigned_role_id === null || row.assignment_session_version === null
        ? null
        : {
            assignedRoleId: row.assigned_role_id,
            sessionVersion: row.assignment_session_version,
            ...(row.previous_role_id === null
              ? {}
              : { previousRoleId: row.previous_role_id }),
          },
    roleDeletionSweep:
      row.deleted_role_id === null
        ? null
        : {
            roleId: row.deleted_role_id,
            previousSlug: row.deleted_role_slug ?? '',
            actorId: row.actor_id ?? '',
            pending: row.deletion_pending ?? false,
            ...(row.deletion_sweep_id === null
              ? {}
              : { sweepId: row.deletion_sweep_id }),
          },
  };
}

/**
 * Inside a unit of work a failure leaves as the driver raised it, and the
 * runner that owns the transaction maps it.
 */
export class PostgresSecurityEventStore extends SecurityEventStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async append(unitOfWork: UnitOfWork, event: NewSecurityEvent): Promise<void> {
    await postgresTransactionOf(unitOfWork)
      .insertInto('security_events')
      .values(toRow(event))
      .execute();
  }

  async appendMany(
    unitOfWork: UnitOfWork,
    events: NewSecurityEvent[],
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const work = postgresTransactionOf(unitOfWork);
    const rows = events.map(toRow);
    for (const slice of rowSlices(rows, EVENT_COLUMNS.length)) {
      await work.insertInto('security_events').values(slice).execute();
    }
  }

  async appendOutsideUnitOfWork(event: NewSecurityEvent): Promise<void> {
    await autocommit(NO_LOCAL_CONSTRAINTS, () =>
      this.database
        .insertInto('security_events')
        .values(toRow(event))
        .execute(),
    );
  }

  async listRecentForUser(
    userId: string,
    limit: number,
  ): Promise<StoredSecurityEvent[]> {
    if (limit < 1) {
      return [];
    }
    const rows = await autocommit(NO_LOCAL_CONSTRAINTS, () =>
      this.database
        .selectFrom('security_events')
        .select(EVENT_COLUMNS)
        .where('target_user_id', '=', userId)
        .orderBy('occurred_at', 'desc')
        .orderBy('id', 'desc')
        .limit(limit)
        .execute(),
    );
    return rows.map(toStoredEvent);
  }
}
