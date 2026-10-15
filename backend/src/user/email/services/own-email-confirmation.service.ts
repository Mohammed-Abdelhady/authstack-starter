import { Injectable, Logger } from '@nestjs/common';
import { PENDING_PURPOSE } from '../../../auth/constants/registration';
import type { ReservedCode } from '../../../auth/interfaces/pending-code.interface';
import {
  ActivationAccounts,
  AddressConfirmation,
} from '../../../auth/pending-codes/activation-accounts';
import { VerificationCodeService } from '../../../auth/services/codes/verification-code.service';
import {
  ConfirmedMove,
  confirmEmailMove,
} from '../../../auth/utils/activation.util';
import { activationCodeInvalid } from '../../../auth/utils/activation-error.util';
import { logUnknownCommit } from '../../../auth/utils/unknown-commit.util';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';
import { SECURITY_NOTICE } from '../../constants/security-notice.constants';
import { SecurityNoticeService } from '../../services/security-notice.service';
import { AccountSessions } from '../../stores/account-sessions';
import type { OwnEmailCaller, OwnEmailState } from '../types/own-email';
import { asOwnEmailFailure } from '../utils/own-email-errors';

/**
 * The signed-in account holder types the code mailed to the address they
 * asked for. The account moves, the session that confirmed stays, and every
 * other session ends with a reason of its own. The old address is told.
 */
@Injectable()
export class OwnEmailConfirmationService {
  private readonly logger = new Logger(OwnEmailConfirmationService.name);

  constructor(
    private readonly accounts: ActivationAccounts,
    private readonly codes: VerificationCodeService,
    private readonly sessions: AccountSessions,
    private readonly ledger: AddressLedger,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly notices: SecurityNoticeService,
  ) {}

  /**
   * @throws AppException ACTIVATION_CODE_INVALID for every code that cannot
   *   move this account, SESSION_INVALID when the confirming session ended
   */
  confirm(caller: OwnEmailCaller, code: string): Promise<OwnEmailState> {
    return this.confirmCode(caller, code).catch(asOwnEmailFailure);
  }

  private async confirmCode(
    caller: OwnEmailCaller,
    code: string,
  ): Promise<OwnEmailState> {
    const before = await this.accounts.findAddressConfirmation(caller.userId);
    if (before?.pendingEmail === undefined) throw activationCodeInvalid();
    const reserved = await this.codes.verifyCode(
      before.pendingEmail,
      code,
      PENDING_PURPOSE.EMAIL_CHANGE,
    );
    if (reserved.userId?.toString() !== caller.userId) {
      throw activationCodeInvalid();
    }

    const at = this.clock.now();
    const moved = await this.move(caller, reserved, before);
    if (moved !== null) {
      this.notices.deferTo(
        { email: moved.previousEmail, locale: moved.locale },
        SECURITY_NOTICE.EMAIL_CHANGED,
        { at },
      );
    }
    return { email: reserved.email };
  }

  private async move(
    caller: OwnEmailCaller,
    reserved: ReservedCode,
    before: AddressConfirmation,
  ): Promise<ConfirmedMove | null> {
    try {
      return await this.runner.run(async (unitOfWork) => {
        if (!(await this.codes.consumeCode(reserved, unitOfWork))) {
          throw activationCodeInvalid();
        }
        const moved = await confirmEmailMove(
          this.accounts,
          unitOfWork,
          reserved,
          this.ledger,
          this.clock.now(),
        );
        if (moved !== null) {
          await this.sessions.revokeAllExcept(
            unitOfWork,
            caller.userId,
            caller.sessionId,
            REVOKED_REASON.EMAIL_CHANGED,
          );
        }
        return moved;
      });
    } catch (error) {
      if (!isUnknownTransactionOutcome(error)) asOwnEmailFailure(error);
      return this.settleUnknown(
        error,
        { ...reserved, userId: caller.userId },
        before,
      );
    }
  }

  /**
   * The commit may have landed. Only an account already on the new address at
   * the code's generation is a success; anything else stays unknown. The old
   * address is the one read before the move: no other move could land at the
   * same generation.
   */
  private async settleUnknown(
    error: unknown,
    reserved: ReservedCode & { userId: string },
    before: AddressConfirmation,
  ): Promise<ConfirmedMove> {
    let after: AddressConfirmation | null;
    try {
      after = await this.accounts.findAddressConfirmation(reserved.userId);
    } catch {
      logUnknownCommit(this.logger, 'Own email change', error);
      asAuthorityUnavailable(error);
    }
    if (
      after === null ||
      after.email !== reserved.email ||
      after.pendingEmail !== undefined ||
      after.addressGeneration !== (reserved.addressGeneration ?? 0)
    ) {
      asAuthorityUnavailable(error);
    }
    logUnknownCommit(this.logger, 'Own email change', error);
    return { previousEmail: before.email, locale: before.locale };
  }
}
