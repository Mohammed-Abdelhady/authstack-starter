import { Injectable } from '@nestjs/common';
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
): NewSecurityEvent {
  return {
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
      { action: SECURITY_EVENT_ACTION.ROLE_DELETED, actorId: ref.actorId },
      occurredAt,
    ),
    eventId: `${ROLE_DELETION_EVENT_PREFIX}${ref.roleId}`,
    roleDeletionSweep: { ...ref, pending: true },
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
  ) {}

  async record(
    unitOfWork: UnitOfWork,
    input: RecordSecurityEventInput,
  ): Promise<void> {
    await this.store.append(
      unitOfWork,
      newSecurityEvent(input, this.clock.now()),
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
      inputs.map((input) => newSecurityEvent(input, occurredAt)),
    );
  }

  async recordRoleDeletion(
    unitOfWork: UnitOfWork,
    ref: Omit<RoleDeletionSweep, 'pending'>,
  ): Promise<void> {
    await this.store.append(
      unitOfWork,
      roleDeletionEvent(ref, this.clock.now()),
    );
  }

  /** For an event recorded outside any atomic workflow, such as a refusal. */
  async recordOutsideUnitOfWork(
    input: RecordSecurityEventInput,
  ): Promise<void> {
    await this.store.appendOutsideUnitOfWork(
      newSecurityEvent(input, this.clock.now()),
    );
  }
}
