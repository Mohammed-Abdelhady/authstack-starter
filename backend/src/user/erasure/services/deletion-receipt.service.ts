import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { Clock } from '../../../common/services/clock';
import type { DeletionReceiptState } from '../constants/deletion-receipt.constants';
import { AccountDeletionStore } from '../stores/account-deletion.store';
import { parseReceiptKey, receiptState } from '../utils/receipt-key';

/** Answers whether a deletion with a key was recorded, and names no account. */
@Injectable()
export class DeletionReceiptService {
  constructor(
    private readonly store: AccountDeletionStore,
    private readonly clock: Clock,
  ) {}

  /** @throws AppException VALIDATION_ERROR for a malformed key */
  async stateOf(rawKey: string): Promise<DeletionReceiptState> {
    const key = parseReceiptKey(rawKey);
    if (!key) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'The receipt key is not one this server stores',
        HttpStatus.BAD_REQUEST,
      );
    }
    const receipt = await this.store.findReceipt(key.hash);
    return receiptState(key, receipt, this.clock.now());
  }
}
