import { USER_SCOPE_ACTION } from '../../constants/user-scope-permissions';
import { AdminAudienceScopes } from './admin-audience-scopes';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CODE_ROTATION } from '../../../auth/pending-codes/pending-registration.store';
import {
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  AddressLedger,
} from '../../../common/persistence/address-ledger';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../../common/persistence/unit-of-work';
import { storedAddress } from '../../../common/persistence/stored-address';
import { Clock } from '../../../common/services/clock';
import { VerificationCodeService } from '../../../auth/services/codes/verification-code.service';
import { AuthMailService } from '../../../auth/services/mail/auth-mail.service';
import {
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  mailedCodeWindowMs,
} from '../../../auth/constants/registration';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { isAdminRole } from '../../../common/utils/role-hierarchy';
import { StoredAccount } from '../../../user/stores/stored-account';
import { AdminAccountStore } from '../../stores/admin-account.store';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';

/** The account a confirmation code is issued for, as it was read. */
type ConfirmationTarget = Pick<
  StoredAccount,
  'id' | 'pendingEmail' | 'addressGeneration' | 'locale' | 'audience'
>;

interface ConfirmationAuthority {
  actorId: string;
  assertCurrent(work: UnitOfWork, current: StoredAccount): Promise<void>;
}

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
    private readonly ledger: AddressLedger,
    private readonly runner: UnitOfWorkRunner,
    private readonly clock: Clock,
    private readonly scopes: AdminAudienceScopes,
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
    owner?: string,
  ): Promise<void> {
    this.assertAdmin(actorRole);

    if (
      !(await this.runner.run((uow) =>
        this.ledger.isFree(uow, {
          address: email,
          now: this.clock.now(),
          owner,
        }),
      ))
    ) {
      throw this.addressTaken();
    }
  }

  /**
   * Issue a code for the account's already-persisted pending address, in the
   * account's language.
   */
  async sendConfirmation(
    user: ConfirmationTarget,
    actorRole: string,
    authority?: string | ConfirmationAuthority,
  ): Promise<void> {
    this.assertAdmin(actorRole);
    const actorId =
      typeof authority === 'string' ? authority : authority?.actorId;
    const pending = this.pendingAddress(user.pendingEmail);

    if (
      !(await this.runner.run((uow) =>
        this.ledger.isFree(uow, {
          address: pending,
          now: this.clock.now(),
          owner: user.id,
        }),
      ))
    ) {
      throw this.addressTaken();
    }

    const issued = await this.verificationCodeService.prepareEmailChange(
      pending,
      { userId: user.id, addressGeneration: user.addressGeneration },
    );
    if (!issued) throw this.limitReached();
    await this.runner.run(async (uow) => {
      const current = await this.accounts.takeEmailChangeTarget(uow, user.id);
      if (current && typeof authority === 'object')
        await authority.assertCurrent(uow, current);
      if (
        !current ||
        current.isDeleted ||
        current.pendingEmail !== pending ||
        current.addressGeneration !== user.addressGeneration
      ) {
        throw this.addressTaken();
      }
      await this.scopes.assertInWork(
        uow,
        actorId,
        current.audience,
        USER_SCOPE_ACTION.UPDATE,
      );
      const claimed = await this.ledger.claim(uow, {
        address: pending,
        owner: current.id,
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        now: this.clock.now(),
        lapsesAt: issued.generation.expiresAt,
      });
      if (claimed === ADDRESS_CLAIM_RESULT.TAKEN) throw this.addressTaken();
      if (
        (await this.verificationCodeService.storeEmailChangeIn(uow, issued)) !==
        CODE_ROTATION.ROTATED
      ) {
        throw this.limitReached();
      }
    });

    await this.sendCode(
      {
        email: pending,
        locale: user.locale,
        ...(user.audience === undefined ? {} : { audience: user.audience }),
      },
      issued.code,
    );
  }

  // feature:invitations:start
  async sendServerCommandConfirmation(user: ConfirmationTarget): Promise<void> {
    const pending = this.pendingAddress(user.pendingEmail);
    const issued = await this.verificationCodeService.prepareEmailChange(
      pending,
      {
        userId: user.id,
        addressGeneration: user.addressGeneration,
      },
    );
    if (!issued) throw this.limitReached();
    await this.runner.run(async (work) => {
      const current = await this.accounts.takeEmailChangeTarget(work, user.id);
      if (
        !current ||
        current.isDeleted ||
        !isAdminRole(current.role) ||
        current.pendingEmail !== pending ||
        current.addressGeneration !== user.addressGeneration
      ) {
        throw this.addressTaken();
      }
      const claimed = await this.ledger.claim(work, {
        address: pending,
        owner: current.id,
        kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
        now: this.clock.now(),
        lapsesAt: issued.generation.expiresAt,
      });
      if (claimed === ADDRESS_CLAIM_RESULT.TAKEN) throw this.addressTaken();
      if (
        (await this.verificationCodeService.storeEmailChangeIn(
          work,
          issued,
        )) !== CODE_ROTATION.ROTATED
      )
        throw this.limitReached();
    });
    await this.sendCode(
      {
        email: pending,
        locale: user.locale,
        ...(user.audience === undefined ? {} : { audience: user.audience }),
      },
      issued.code,
    );
  }
  // feature:invitations:end

  async claimPendingIn(
    uow: UnitOfWork,
    current: StoredAccount,
    address: string,
  ): Promise<void> {
    const now = this.clock.now();
    const claimed = await this.ledger.claim(uow, {
      address,
      owner: current.id,
      kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
      now,
      lapsesAt: this.verificationCodeService.codeExpiresAt(now),
    });
    if (claimed === ADDRESS_CLAIM_RESULT.TAKEN) throw this.addressTaken();
    if (
      current.pendingEmail &&
      storedAddress(current.pendingEmail) !== storedAddress(address)
    ) {
      await this.ledger.release(uow, {
        address: current.pendingEmail,
        owner: current.id,
      });
    }
  }

  private addressTaken(): AppException {
    return new AppException(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Email already in use',
      HttpStatus.CONFLICT,
    );
  }

  /** Notify the active mailbox without delaying the admin response on SMTP. */
  notifyPreviousAddress(recipient: MailRecipient): void {
    this.authMailService.deferEmailChangeNotice(recipient);
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
    user: ConfirmationTarget,
    actorRole: string,
    authority?: string | ConfirmationAuthority,
  ): Promise<void> {
    await this.sendConfirmation(user, actorRole, authority);
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

  private async sendCode(
    recipient: MailRecipient,
    code: string,
  ): Promise<void> {
    // AuthMailService logs the failure with the request id and never the raw
    // transport message; the admin gets the shared send failure.
    const sent = await this.authMailService.sendEmailChangeCode(
      recipient,
      code,
    );
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
