import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type {
  EnrolmentPromotionInput,
  PromotedEnrolmentSession,
} from './types/enrolment-promotion';

/**
 * Runs inside the caller's registration unit of work; a no-op for other sessions.
 * Throws AppException PASSKEY_CHALLENGE_INVALID for a lost or mismatched
 * session, matching today's passkey registration refusal.
 * Wrap the caller's runner with withRefusalRecorded to retain refusal events.
 */
export abstract class EnrolmentPromotion {
  /** Wrap the registration runner so refusal events are written after rollback. */
  withRefusalRecorded<Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> {
    return operation();
  }

  abstract promoteAfterFirstPasskey(
    unitOfWork: UnitOfWork,
    input: EnrolmentPromotionInput,
  ): Promise<void>;

  /** Return from the UOW callback; publish cookies only after its commit succeeds. */
  takePromotedSessionIn(
    _unitOfWork: UnitOfWork,
  ): PromotedEnrolmentSession | undefined {
    return undefined;
  }
}
