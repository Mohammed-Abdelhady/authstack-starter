import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type {
  InvitationListQuery,
  InvitationPage,
  InvitationTokenChange,
  NewInvitation,
  StoredInvitation,
} from '../types/invitation';

/**
 * Invitations and enrolment links. Every change takes the caller's unit of
 * work. A `take` read locks the row until that unit of work ends: a second
 * unit of work that takes the same row waits, or is refused with a retryable
 * abort and runs again, so one token is spent once.
 */
export abstract class InvitationStore {
  abstract insert(
    unitOfWork: UnitOfWork,
    invitation: NewInvitation,
  ): Promise<StoredInvitation>;

  /** A committed read, for answers and refusals made before any write. */
  abstract findById(id: string): Promise<StoredInvitation | null>;

  abstract takeById(
    unitOfWork: UnitOfWork,
    id: string,
  ): Promise<StoredInvitation | null>;

  abstract takeByTokenHash(
    unitOfWork: UnitOfWork,
    tokenHash: string,
  ): Promise<StoredInvitation | null>;

  /** A resend: a new token and a new lifetime. The old token stops matching. */
  abstract replaceToken(
    unitOfWork: UnitOfWork,
    id: string,
    change: InvitationTokenChange,
  ): Promise<StoredInvitation>;

  abstract markAccepted(
    unitOfWork: UnitOfWork,
    id: string,
    at: Date,
  ): Promise<void>;

  abstract markRevoked(
    unitOfWork: UnitOfWork,
    id: string,
    at: Date,
  ): Promise<void>;

  /** Revokes every enrolment link of the account that is still open. Returns how many. */
  abstract revokeOpenEnrolmentLinks(
    unitOfWork: UnitOfWork,
    userId: string,
    at: Date,
  ): Promise<number>;

  /** Account and first-administrator invitations, newest first. Never enrolment links. */
  abstract list(query: InvitationListQuery): Promise<InvitationPage>;

  /**
   * Whether an invitation that is neither accepted, revoked nor expired would
   * make an administrator: a first-administrator one, or one for `adminRole`.
   */
  abstract hasOpenAdminInvitation(
    unitOfWork: UnitOfWork,
    adminRole: string,
    now: Date,
  ): Promise<boolean>;
}
