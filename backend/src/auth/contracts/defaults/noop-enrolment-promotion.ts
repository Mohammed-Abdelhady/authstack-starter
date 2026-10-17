import { Injectable } from '@nestjs/common';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { EnrolmentPromotionInput } from '../types/enrolment-promotion';
import { EnrolmentPromotion } from '../enrolment-promotion';

@Injectable()
export class NoopEnrolmentPromotion extends EnrolmentPromotion {
  promoteAfterFirstPasskey(
    _unitOfWork: UnitOfWork,
    _input: EnrolmentPromotionInput,
  ): Promise<void> {
    return Promise.resolve();
  }
}
