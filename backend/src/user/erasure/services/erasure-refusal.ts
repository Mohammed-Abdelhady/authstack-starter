import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AccountDeletionStore } from '../stores/account-deletion.store';

/**
 * The answer a sign-in path gives a deactivated account once its credential
 * was right. Only then may the person learn the account is scheduled for
 * erasure, and when: before it, a request answers as for any address.
 */
@Injectable()
export class ErasureRefusal {
  constructor(private readonly store: AccountDeletionStore) {}

  /**
   * `ACCOUNT_ERASURE_PENDING` with `details.eraseAfter` while the account has
   * an erasure date, else the path's own deactivation refusal.
   */
  async refusalFor(
    userId: string,
    deactivated: AppException,
  ): Promise<AppException> {
    const eraseAfter = await this.store.findEraseAfter(userId);
    if (!eraseAfter) return deactivated;
    return new AppException(
      ErrorCode.ACCOUNT_ERASURE_PENDING,
      'This account is scheduled for erasure',
      HttpStatus.FORBIDDEN,
      { eraseAfter: eraseAfter.toISOString() },
    );
  }
}
