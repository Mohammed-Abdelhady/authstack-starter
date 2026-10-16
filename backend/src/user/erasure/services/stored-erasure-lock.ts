import { HttpStatus, Injectable } from '@nestjs/common';
import { ErasureLock } from '../../../auth/contracts/erasure-lock';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { ERASURE_STANDING } from '../constants/erasure.constants';
import { ErasureJobStore } from '../stores/erasure-job.store';

/**
 * The lock a restore takes: the account row, the same one step 1 of an
 * erasure takes, so the two never both go on. A restore that wins clears the
 * schedule; once step 1 has committed it is refused.
 */
@Injectable()
export class StoredErasureLock extends ErasureLock {
  constructor(private readonly jobs: ErasureJobStore) {
    super();
  }

  /** @throws AppException CONFLICT once the account's erasure has started */
  async assertRestorable(
    unitOfWork: UnitOfWork,
    userId: string,
  ): Promise<void> {
    const standing = await this.jobs.holdForRestoreIn(unitOfWork, userId);
    if (standing === ERASURE_STANDING.ERASING) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'This account is being erased and can no longer be restored',
        HttpStatus.CONFLICT,
      );
    }
  }
}
