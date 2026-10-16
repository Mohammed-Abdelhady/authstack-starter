import { HttpStatus, Injectable } from '@nestjs/common';
import { buildAccountErasureMail } from '../../../mail/builders/account-erasure';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import { MailService } from '../../../mail/mail.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { StoredAccount } from '../../stores/stored-account';
import { DELETION_OPERATION } from '../constants/deletion-receipt.constants';
import { AccountDeletionStore } from '../stores/account-deletion.store';
import type { DeletionOutcome, ReceiptKey } from '../types/account-deletion';
import { parseReceiptKey, receiptPurgeAfter } from '../utils/receipt-key';
import { ErasureSettings } from './erasure-settings';
import { ErasureWorker } from './erasure-worker';

/**
 * What a person's own deletion adds to the deactivation: the erasure date
 * while erasure is on, the receipt of the key the client sent, and the mail
 * that names the date.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly store: AccountDeletionStore,
    private readonly settings: ErasureSettings,
    private readonly worker: ErasureWorker,
    private readonly mail: MailService,
    private readonly dispatcher: MailDispatcherService,
  ) {}

  /** @throws AppException VALIDATION_ERROR for a malformed key */
  receiptKeyOf(raw: string | undefined): ReceiptKey | undefined {
    if (raw === undefined) return undefined;
    const key = parseReceiptKey(raw);
    if (!key) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'The receipt key is not one this server can store',
        HttpStatus.BAD_REQUEST,
      );
    }
    return key;
  }

  /**
   * The answer a repeat of an already recorded deletion gets, read before the
   * account is. Undefined when this key was not used yet.
   *
   * @throws AppException CONFLICT when another account used the key
   */
  async repeatedIn(
    unitOfWork: UnitOfWork,
    userId: string,
    key: ReceiptKey | undefined,
  ): Promise<DeletionOutcome | undefined> {
    if (!key) return undefined;
    const receipt = await this.store.findReceiptIn(unitOfWork, key.hash);
    if (!receipt) return undefined;
    if (receipt.userId !== userId) {
      throw new AppException(
        ErrorCode.CONFLICT,
        'This receipt key was already used',
        HttpStatus.CONFLICT,
      );
    }
    return receipt.eraseAfter ? { eraseAfter: receipt.eraseAfter } : {};
  }

  /** In the unit of work that deactivates the account and ends its sessions. */
  async recordIn(
    unitOfWork: UnitOfWork,
    account: StoredAccount,
    deletedAt: Date,
    key: ReceiptKey | undefined,
  ): Promise<DeletionOutcome> {
    const eraseAfter = this.settings.eraseAfter(deletedAt);
    await this.store.recordIn(unitOfWork, {
      userId: account.id,
      deletedAt,
      eraseAfter,
      ...(key && {
        receipt: {
          keyHash: key.hash,
          operation: DELETION_OPERATION.ACCOUNT_DELETION,
          recordedAt: deletedAt,
          purgeAfter: receiptPurgeAfter(deletedAt),
        },
      }),
    });
    if (!eraseAfter) return {};
    // Like a security notice, only to an address the account proved it owns.
    if (!account.isVerified) return { eraseAfter };
    return {
      eraseAfter,
      recipient: { email: account.email, locale: account.locale },
    };
  }

  /**
   * Once the deactivation committed: the mail when there is a recipient, and
   * an erasure due now whether or not anyone is mailed.
   */
  afterCommit(outcome: DeletionOutcome, now: Date): void {
    const { eraseAfter, recipient } = outcome;
    if (!eraseAfter) return;
    if (recipient) {
      this.dispatcher.dispatch(
        () =>
          this.mail.sendMail({
            to: recipient.email,
            ...buildAccountErasureMail({
              locale: recipient.locale,
              eraseAfter,
            }),
          }),
        'Erasure date mail failed',
      );
    }
    if (eraseAfter.getTime() <= now.getTime()) void this.worker.runOnce();
  }
}
