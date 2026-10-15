import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { EnrolmentPromotionInput } from './types/enrolment-promotion';

/**
 * Runs inside the caller's registration unit of work; a no-op for other sessions.
 * Throws AppException PASSKEY_CHALLENGE_INVALID for a lost or mismatched
 * session, matching today's passkey registration refusal.
 */
export abstract class EnrolmentPromotion {
  abstract promoteAfterFirstPasskey(
    unitOfWork: UnitOfWork,
    input: EnrolmentPromotionInput,
  ): Promise<void>;
}
