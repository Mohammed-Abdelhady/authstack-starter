import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityDetails } from './types/activity-event';
import { ACTIVITY_RETENTION_DAYS_DEFAULT } from '../../config/constants/host-contracts';
import { eventActivityFields } from './utils/activity-details';
import {
  ACTIVITY_DAY_MS,
  SIGN_IN_RETENTION_DAYS,
} from './constants/activity-details';
import { randomUUID } from 'crypto';
import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
import {
  ROLE_DELETION_EVENT_PREFIX,
  SECURITY_EVENT_ACTION,
  SECURITY_EVENT_OUTCOME,
} from '../constants/security-event-action';
import { RoleAssignmentEvent } from '../types/role-assignment-event';
import { RoleDeletionSweep } from '../types/role-deletion-sweep';
import { NewSecurityEvent, SecurityEventStore } from './security-event.store';

export interface RecordSecurityEventInput {
  details?: ActivityDetails;
  actorId?: string;
  targetUserId?: string;
  clientId?: string;
  sessionId?: string;
  action: string;
  reasonCode?: string;
  requestId?: string;
  outcome?: string;
  roleAssignment?: RoleAssignmentEvent;
}

/** Gives an event its id, its time and its default outcome. */
export function newSecurityEvent(
  input: RecordSecurityEventInput,
  occurredAt: Date,
  staffRetentionDays?: number,
): NewSecurityEvent {
  const activity = eventActivityFields(input);
  const days =
    activity.kind === 'staff'
      ? (staffRetentionDays ?? ACTIVITY_RETENTION_DAYS_DEFAULT)
      : SIGN_IN_RETENTION_DAYS;
  return {
    ...activity,
    ...(staffRetentionDays === undefined
      ? {}
      : {
          purgeAfter: new Date(occurredAt.getTime() + days * ACTIVITY_DAY_MS),
        }),
    eventId: randomUUID(),
    actorId: input.actorId,
    targetUserId: input.targetUserId,
    clientId: input.clientId,
    sessionId: input.sessionId,
    action: input.action,
    reasonCode: input.reasonCode,
    requestId: input.requestId,
    roleAssignment: input.roleAssignment,
    outcome: input.outcome ?? SECURITY_EVENT_OUTCOME.SUCCEEDED,
    occurredAt,
  };
}

/** A role's deletion, under an id only one deletion of that role can take. */
export function roleDeletionEvent(
  ref: Omit<RoleDeletionSweep, 'pending'>,
  occurredAt: Date,
): NewSecurityEvent {
  return {
    ...newSecurityEvent(
      {
        action: SECURITY_EVENT_ACTION.ROLE_DELETED,
        actorId: ref.actorId,
        details: { roleId: ref.roleId, slug: ref.previousSlug },
      },
      occurredAt,
    ),
    eventId: `${ROLE_DELETION_EVENT_PREFIX}${ref.roleId}`,
    roleDeletionSweep: {
      roleId: ref.roleId,
      previousSlug: ref.previousSlug,
      actorId: ref.actorId,
      ...(ref.sweepId === undefined ? {} : { sweepId: ref.sweepId }),
      pending: true,
    },
  };
}

/**
 * Records security events. An event that belongs to an atomic workflow takes
 * that workflow's unit of work, so the state change and its event commit
 * together or not at all.
 */
@Injectable()
export class SecurityEventRecorder {
  constructor(
    private readonly store: SecurityEventStore,
    private readonly clock: Clock,
    @Optional() private readonly config?: ConfigService,
  ) {}

  private retentionDays(): number {
    return (
      this.config?.get<number>('activity.retentionDays') ??
      ACTIVITY_RETENTION_DAYS_DEFAULT
    );
  }

  async record(
    unitOfWork: UnitOfWork,
    input: RecordSecurityEventInput,
  ): Promise<void> {
    await this.store.append(
      unitOfWork,
      newSecurityEvent(input, this.clock.now(), this.retentionDays()),
    );
  }

  async recordMany(
    unitOfWork: UnitOfWork,
    inputs: RecordSecurityEventInput[],
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    const occurredAt = this.clock.now();
    await this.store.appendMany(
      unitOfWork,
      inputs.map((input) =>
        newSecurityEvent(input, occurredAt, this.retentionDays()),
      ),
    );
  }

  async recordRoleDeletion(
    unitOfWork: UnitOfWork,
    ref: Omit<RoleDeletionSweep, 'pending'>,
  ): Promise<void> {
    const occurredAt = this.clock.now();
    await this.store.append(unitOfWork, {
      ...roleDeletionEvent(ref, occurredAt),
      purgeAfter: new Date(
        occurredAt.getTime() + this.retentionDays() * ACTIVITY_DAY_MS,
      ),
    });
  }

  /** For an event recorded outside any atomic workflow, such as a refusal. */
  async recordOutsideUnitOfWork(
    input: RecordSecurityEventInput,
  ): Promise<void> {
    await this.store.appendOutsideUnitOfWork(
      newSecurityEvent(input, this.clock.now(), this.retentionDays()),
    );
  }
}
