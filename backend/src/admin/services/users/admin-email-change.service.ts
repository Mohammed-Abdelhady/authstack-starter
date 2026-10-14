import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationCodeService } from '../../../auth/services/codes/verification-code.service';
import { AuthMailService } from '../../../auth/services/mail/auth-mail.service';
import {
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  PENDING_PURPOSE,
  mailedCodeWindowMs,
} from '../../../auth/constants/registration';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import { StoredAccount } from '../../../user/stores/stored-account';
import { AdminAccountStore } from '../../stores/admin-account.store';

/**
 * Admin-initiated email changes.
 * Only admins may ask for an account to move to another address. The account
 * keeps its own address until the new mailbox confirms the code.
 */
@Injectable()
export class AdminEmailChangeService {
  private readonly logger = new Logger(AdminEmailChangeService.name);
  private readonly retryMinutes: number;

  constructor(
    private readonly accounts: AdminAccountStore,
    private readonly verificationCodeService: VerificationCodeService,
    private readonly authMailService: AuthMailService,
    configService: ConfigService,
  ) {
    this.retryMinutes = Math.ceil(
      mailedCodeWindowMs(
        configService.get<number>(
          'activation.codeExpiresIn',
          ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
        ),
      ) / 60000,
    );
  }

  /** Refuse an active address before the account stores it as pending. */
  async assertAddressAvailable(
    email: string,
    actorRole: string,
  ): Promise<void> {
    this.assertAdmin(actorRole);

    if (await this.accounts.isAddressTaken(email)) {
      throw new AppException(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email already in use',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Issue a code for the account's already-persisted pending address. */
  async sendConfirmation(
    user: Pick<StoredAccount, 'id' | 'pendingEmail' | 'addressGeneration'>,
    actorRole: string,
  ): Promise<void> {
    this.assertAdmin(actorRole);
    const pending = this.pendingAddress(user.pendingEmail);

    if (await this.accounts.isAddressTaken(pending)) {
      throw new AppException(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Email already in use',
        HttpStatus.CONFLICT,
      );
    }

    const issued =
      await this.verificationCodeService.createOrUpdatePendingRegistration(
        pending,
        PENDING_PURPOSE.EMAIL_CHANGE,
        { userId: user.id, addressGeneration: user.addressGeneration },
      );

    if (!issued) {
      throw this.limitReached();
    }

    await this.sendCode(pending, issued.code);
  }

  /** Notify the active mailbox without delaying the admin response on SMTP. */
  notifyPreviousAddress(email: string): void {
    this.authMailService.deferEmailChangeNotice(email);
  }

  /**
   * Re-send the confirmation for the address the account waits to confirm.
   * Goes through the same refresh, so it gets a fresh code and resets the
   * attempt count, up to the per-address mail cap. Does not change the address
   * or the generation.
   *
   * @param user - The target account as it was read
   * @param actorRole - Role slug of the acting account
   * @throws AppException EMAIL_CHANGE_NOT_ALLOWED, EMAIL_SEND_LIMIT_REACHED or
   * EMAIL_SEND_FAILED
   */
  async resend(
    user: Pick<StoredAccount, 'id' | 'pendingEmail' | 'addressGeneration'>,
    actorRole: string,
  ): Promise<void> {
    await this.sendConfirmation(user, actorRole);
  }

  private pendingAddress(address: string | undefined): string {
    if (address === undefined) {
      throw new AppException(
        ErrorCode.EMAIL_SEND_FAILED,
        'This account has no address waiting to be confirmed',
        HttpStatus.BAD_REQUEST,
      );
    }
    return address;
  }

  /** Admin by the stored admin role, never by a level another role can reach. */
  private assertAdmin(actorRole: string): void {
    if (!isAdminRole(actorRole)) {
      throw new AppException(
        ErrorCode.EMAIL_CHANGE_NOT_ALLOWED,
        'Only admins can change the email address of another account',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** The per-address mail cap is in force; say when the address can retry. */
  private limitReached(): AppException {
    return new AppException(
      ErrorCode.EMAIL_SEND_LIMIT_REACHED,
      `Too many confirmation emails sent to this address; try again in ${this.retryMinutes} minutes`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async sendCode(email: string, code: string): Promise<void> {
    // AuthMailService logs the failure with the request id and never the raw
    // transport message; the admin gets the shared send failure.
    const sent = await this.authMailService.sendEmailChangeCode(email, code);
    if (!sent) {
      this.logger.error('Email change confirmation was not handed over');
      throw new AppException(
        ErrorCode.EMAIL_SEND_FAILED,
        'Failed to send verification email',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
