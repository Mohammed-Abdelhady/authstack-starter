import {
  ActivityEventFields,
  ActivityQuery,
  ActivityDetails,
  SecurityEventKind,
} from './types/activity-event';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RoleAssignmentEvent } from '../types/role-assignment-event';
import { RoleDeletionSweep } from '../types/role-deletion-sweep';

export const SECURITY_EVENT_CONSTRAINT = {
  EVENT_ID: 'security_event.event_id',
} as const;

/** One event as the recorder hands it over. Ids of other records are opaque text. */
export interface NewSecurityEvent extends ActivityEventFields {
  eventId: string;
  actorId?: string;
  targetUserId?: string;
  clientId?: string;
  sessionId?: string;
  action: string;
  reasonCode?: string;
  requestId?: string;
  outcome: string;
  occurredAt: Date;
  roleAssignment?: RoleAssignmentEvent;
  roleDeletionSweep?: RoleDeletionSweep;
}

export interface StoredSecurityEvent {
  kind: SecurityEventKind;
  details: ActivityDetails;
  purgeAfter: Date;
  eventId: string;
  actorId: string | null;
  targetUserId: string | null;
  clientId: string | null;
  sessionId: string | null;
  action: string;
  reasonCode: string | null;
  requestId: string | null;
  outcome: string;
  occurredAt: Date;
  roleAssignment: RoleAssignmentEvent | null;
  roleDeletionSweep: RoleDeletionSweep | null;
}

/**
 * The append-only record of security events. An event id that is already stored
 * is refused by the database's unique rule, as a `UniqueConflictError` named
 * `SECURITY_EVENT_CONSTRAINT.EVENT_ID`.
 *
 * How long an event is kept is the database's own setting. Nothing reads an
 * event to decide whether something is still valid, so no read here depends on
 * the cleanup having run.
 */
export abstract class SecurityEventStore {
  abstract listActivity(
    query: ActivityQuery,
    now: Date,
  ): Promise<{ data: StoredSecurityEvent[]; total: number }>;
  /** Commits or rolls back with the unit of work, and never on its own. */
  abstract append(
    unitOfWork: UnitOfWork,
    event: NewSecurityEvent,
  ): Promise<void>;

  /** Every event or none: they share the unit of work's outcome. */
  abstract appendMany(
    unitOfWork: UnitOfWork,
    events: NewSecurityEvent[],
  ): Promise<void>;

  /** For an event that belongs to no atomic workflow. Commits by itself. */
  abstract appendOutsideUnitOfWork(event: NewSecurityEvent): Promise<void>;

  /**
   * A plain read for an investigation, newest first, and for one instant the
   * event appended last comes first.
   */
  abstract listRecentForUser(
    userId: string,
    limit: number,
  ): Promise<StoredSecurityEvent[]>;
}
