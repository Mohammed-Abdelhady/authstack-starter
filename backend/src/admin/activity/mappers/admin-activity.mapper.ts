import { StoredSecurityEvent } from '../../../session/events/security-event.store';
import { AdminActivityDto } from '../dto/admin-activity-response.dto';

export function toAdminActivityDto(
  event: StoredSecurityEvent,
): AdminActivityDto {
  return {
    id: event.eventId,
    occurredAt: event.occurredAt,
    action: event.action,
    outcome: event.outcome,
    actorId: event.actorId,
    targetUserId: event.targetUserId,
    clientId: event.clientId,
    sessionId: event.sessionId,
    details: event.details,
    roleAssignment: event.roleAssignment
      ? {
          assignedRoleId: event.roleAssignment.assignedRoleId,
          previousRoleId: event.roleAssignment.previousRoleId ?? null,
        }
      : null,
  };
}
