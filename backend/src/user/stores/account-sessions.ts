import { UnitOfWork } from '../../common/persistence/unit-of-work';
import { RoleAssignmentEvent } from '../../session/types/role-assignment-event';

/** Who ended an account's sessions and why, kept on the security event. */
export interface SessionRevocationReason {
  actorId?: string;
  reasonCode?: string;
  roleAssignment?: RoleAssignmentEvent;
}

/**
 * Ends an account's sessions inside the caller's unit of work, so an account
 * change and the sign-out it causes commit or roll back together. Both methods
 * write the account's session version and record the security event.
 */
export abstract class AccountSessions {
  /** Ends every session. Answers with how many were live. */
  abstract revokeAll(
    unitOfWork: UnitOfWork,
    userId: string,
    reason?: SessionRevocationReason,
  ): Promise<number>;

  /**
   * Ends every session but one. Refuses with SESSION_INVALID when the session
   * to keep is not a live session of this account.
   */
  abstract revokeAllExcept(
    unitOfWork: UnitOfWork,
    userId: string,
    keptSessionId: string,
  ): Promise<number>;
}
