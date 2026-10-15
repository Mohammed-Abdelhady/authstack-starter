import { Injectable, Logger } from '@nestjs/common';
import { AddressLedger } from '../../../common/persistence/address-ledger';
import { Clock } from '../../../common/services/clock';
import { ApiResponse } from '../../../common/dto/api-response.dto';
import { isUnknownTransactionOutcome } from '../../../common/exceptions/unknown-transaction-outcome.error';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { ActivationAccounts } from '../../pending-codes/activation-accounts';
import { AccountSessions } from '../../../user/stores/account-sessions';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import { VerificationCodeService } from '../codes/verification-code.service';
import { confirmEmailChange } from '../../utils/activation.util';
import { activationCodeInvalid } from '../../utils/activation-error.util';
import { PENDING_PURPOSE } from '../../constants/registration';
import { ReservedCode } from '../../interfaces/pending-code.interface';
import { ConfirmEmailChangeDto } from '../../dto/confirm-email-change.dto';
import { logUnknownCommit } from '../../utils/unknown-commit.util';
import { asAuthorityUnavailable } from '../../../session/utils/authority/authority-unavailable';

/**
 * Confirms the address an admin asked an account to move to. The account
 * keeps its previous address until this succeeds. It is its own operation: no
 * password is involved, no session is issued, and the record must still match
 * the user and the address generation it was issued under. A move ends the
 * account's sessions, because whoever confirms from the new mailbox need not
 * be whoever was signed in.
 */
@Injectable()
export class EmailChangeConfirmationService {
  private readonly logger = new Logger(EmailChangeConfirmationService.name);

  constructor(
    private readonly accounts: ActivationAccounts,
    private readonly runner: UnitOfWorkRunner,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly sessions: AccountSessions,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
  ) {}

  async confirm(
    dto: ConfirmEmailChangeDto,
  ): Promise<ApiResponse<{ message: string }>> {
    const reserved = await this.verificationCodeService.verifyCode(
      dto.email,
      dto.code,
      PENDING_PURPOSE.EMAIL_CHANGE,
    );

    try {
      await this.runner.run(async (unitOfWork) => {
        const consumed = await this.verificationCodeService.consumeCode(
          reserved,
          unitOfWork,
        );
        if (!consumed) {
          throw activationCodeInvalid();
        }
        const left = await confirmEmailChange(
          this.accounts,
          unitOfWork,
          reserved,
          this.ledger,
          this.clock.now(),
        );
        if (left !== null && reserved.userId) {
          await this.sessions.revokeAll(
            unitOfWork,
            reserved.userId.toString(),
            { reasonCode: REVOKED_REASON.ADMIN_FORCED },
          );
        }
      });
    } catch (error) {
      if (!isUnknownTransactionOutcome(error)) {
        throw storeFailureCause(error);
      }
      // The commit may have landed. Only an account already on this address
      // answers success; an absent or unreadable row stays an unknown outcome.
      let confirmed: boolean;
      try {
        confirmed = await this.confirmedForGeneration(reserved);
      } catch {
        logUnknownCommit(this.logger, 'Email change', error);
        asAuthorityUnavailable(error);
      }
      if (!confirmed) {
        asAuthorityUnavailable(error);
      }
      logUnknownCommit(this.logger, 'Email change', error);
    }

    return ApiResponse.success({
      message: 'Email address confirmed. Sign in to continue.',
    });
  }

  /** True when the account is already on this address, verified. */
  private async confirmedForGeneration(
    reserved: ReservedCode,
  ): Promise<boolean> {
    if (!reserved.userId) {
      return false;
    }
    const user = await this.accounts.findAddressConfirmation(
      reserved.userId.toString(),
    );
    return (
      user !== null &&
      user.isVerified &&
      user.email === reserved.email &&
      user.pendingEmail === undefined &&
      user.addressGeneration === (reserved.addressGeneration ?? 0)
    );
  }
}
