import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { VerifiedPasskeyProof } from '../../contracts/types/passkey-proof';

/**
 * Where turning an enrolment session into a full one joins the registration
 * that stores the first passkey, in the same unit of work. A refusal throws
 * and rolls the passkey back with it.
 *
 * Shaped exactly as `contracts/enrolment-promotion.ts` will be, so moving to
 * that contract is an import change.
 */
export abstract class EnrolmentPromotion {
  abstract promoteAfterFirstPasskey(
    unitOfWork: UnitOfWork,
    input: {
      readonly sessionId: string;
      readonly userId: string;
      readonly clientId: string;
      readonly proof: VerifiedPasskeyProof;
    },
  ): Promise<void>;
}

/** With no enrolment policy, a registration stores the passkey alone. */
@Injectable()
export class NoEnrolmentPromotion extends EnrolmentPromotion {
  promoteAfterFirstPasskey(): Promise<void> {
    return Promise.resolve();
  }
}
