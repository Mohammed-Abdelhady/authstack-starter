import type { AdminUserDto } from '../dto/admin-user-response.dto';
import type { StoredRole } from '../../role/stores/role-records';
import type { RoleAudience } from '../../host/types/host-role.type';
// feature:invitations:start
import type { AdminInvitationDto } from '../invitations/dto/admin-invitation.dto';
// feature:invitations:end

export type StaffCreateResult =
  | { readonly account: AdminUserDto; readonly audience?: RoleAudience }
  | { readonly role: StoredRole }
  // feature:invitations:start
  | { readonly invitation: AdminInvitationDto };

// feature:invitations:end
import type {
  IDEMPOTENCY_CLAIM,
  STAFF_OPERATION,
} from '../constants/staff-operations';

export type StaffOperation =
  (typeof STAFF_OPERATION)[keyof typeof STAFF_OPERATION];

/** A key belongs to one actor, one application and one operation. */
export interface IdempotencyScope {
  readonly actorId: string;
  readonly clientId: string;
  readonly operation: StaffOperation;
  readonly key: string;
}

export interface IdempotencyClaimInput {
  readonly scope: IdempotencyScope;
  /** SHA-256 of the operation and the request body, so a changed body is told apart. */
  readonly requestHash: string;
  readonly secretHash?: string;
  readonly now: Date;
  readonly expiresAt: Date;
}

export type IdempotencyClaim =
  | { readonly status: typeof IDEMPOTENCY_CLAIM.CLAIMED }
  | {
      readonly status: typeof IDEMPOTENCY_CLAIM.EXISTING;
      readonly requestHash: string;
      /** What the first create made. Null only while that create has not committed. */
      readonly resourceId: string | null;
      readonly result: StaffCreateResult | null;
      readonly secretHash: string | null;
    };
