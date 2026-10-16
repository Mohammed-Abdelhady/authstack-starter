import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AddressReservationTakenError } from '../../../common/persistence/address-reservation-taken.error';
import {
  ACCOUNT_RESERVATION_RESULT,
  AddressLedger,
} from '../../../common/persistence/address-ledger';
import {
  UnitOfWorkRunner,
  UnitOfWork,
} from '../../../common/persistence/unit-of-work';
import { Clock } from '../../../common/services/clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { AuthMailService } from '../../services/mail/auth-mail.service';
import { MagicLinkAccounts } from '../../magic-link/stores/magic-link-accounts';
import type { MagicLinkAccount } from '../../magic-link/stores/magic-link-accounts';
import { MagicLinkStore } from '../../magic-link/stores/magic-link.store';
import {
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_RATE_WINDOW_MS,
} from '../../magic-link/constants/magic-link.constants';
import {
  createMagicLinkToken,
  deriveNameFromEmail,
  hashMagicLinkToken,
} from '../../magic-link/utils/magic-link-token.util';
import { SIGN_IN_LINK_EMAIL_FAILED_MESSAGE } from '../../constants/auth-messages';
import { MailDispatcherService } from '../../../mail/mail-dispatcher.service';
import { currentRequestId } from '../../../common/context/request-context';
import { NATIVE_EMAIL_CALLBACK_PARAM } from '../constants/native-lifecycle.constants';
import type { SupportedLocale } from '../../../common/constants/locales';
import type { MailRecipient } from '../../../mail/types/mail-recipient.types';
import { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../constants/account-creation';
import type { AccountCreationMethod } from '../../types/account-creation';
import { nativeSignUpOpen } from './native-sign-up-open';

const MILLISECONDS_PER_MINUTE = 60000;

@Injectable()
export class NativeEmailLinkMailService {
  private readonly logger = new Logger(NativeEmailLinkMailService.name);
  private readonly maxPerHour: number;

  constructor(
    private readonly links: MagicLinkStore,
    private readonly accounts: MagicLinkAccounts,
    private readonly config: ConfigService,
    private readonly authMail: AuthMailService,
    private readonly dispatcher: MailDispatcherService,
    private readonly clock: Clock,
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
    private readonly runner: UnitOfWorkRunner,
  ) {
    this.maxPerHour = this.config.get<number>('magicLink.maxPerHour', 5);
  }

  /**
   * Mails the link in the account's language, or in the request's when the
   * address has no account.
   */
  async request(
    requested: MailRecipient,
    callbackUri: string,
    attemptId: string,
    state: string,
    expiresAt: Date,
    clientId: string,
    persistTokenHash: (tokenHash: string) => Promise<void>,
  ): Promise<void> {
    const { email } = requested;
    const now = this.clock.now();
    const owner = await this.accounts.findLinkRecipient(email);
    const deleted = owner?.isDeleted === true;
    const underCap = await this.links.takeRequestSlot(email, {
      now,
      windowMs: MAGIC_LINK_RATE_WINDOW_MS,
      limit: this.maxPerHour,
    });
    const signUpOpen = await nativeSignUpOpen(
      this.runner,
      this.policy,
      clientId,
      ACCOUNT_CREATION_METHOD.MAGIC_LINK,
    );
    const mayCreate = owner !== null || signUpOpen;
    const mailed = !deleted && mayCreate && underCap;
    const token = createMagicLinkToken();
    const callback = mailed
      ? this.nativeCallback(callbackUri, attemptId, token, state)
      : null;
    await persistTokenHash(hashMagicLinkToken(token));

    if (callback) {
      this.deferLink(
        { email, locale: owner?.locale ?? requested.locale },
        callback,
        expiresAt,
        currentRequestId() ?? 'unknown',
      );
    } else if (!mayCreate) {
      this.logger.warn(
        `Magic link not mailed: sign-up closed requestId=${currentRequestId() ?? 'unknown'}`,
      );
    } else if (deleted) {
      this.logger.warn('Magic link request for a deleted account');
    } else {
      this.logger.warn(
        `Magic link hourly cap reached requestId=${currentRequestId() ?? 'unknown'}`,
      );
    }
  }

  async resolveAccountIn(
    unitOfWork: UnitOfWork,
    email: string,
    locale: SupportedLocale,
    clientId: string,
    refuse: () => AppException = () => this.invalidNativeLink(),
    method: AccountCreationMethod = ACCOUNT_CREATION_METHOD.MAGIC_LINK,
    refuseDeactivated: () => AppException = refuse,
  ): Promise<MagicLinkAccount> {
    const existing = await this.accounts.findByEmailIn(unitOfWork, email);
    if (existing?.isDeleted) throw refuseDeactivated();
    if (existing) {
      if (existing.isVerified) return existing;
      if (!(await this.accounts.markVerifiedIn(unitOfWork, existing))) {
        throw refuse();
      }
      const verified = await this.accounts.findByEmailIn(unitOfWork, email);
      if (verified?.isDeleted) throw refuseDeactivated();
      if (!verified || !verified.isVerified) throw refuse();
      return verified;
    }
    const audience = await this.policy.assertMayCreate(
      { application: clientId, method },
      unitOfWork,
    );
    const reservation = await this.ledger.reserveForAccount(unitOfWork, {
      address: email,
      now: this.clock.now(),
    });
    if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN) {
      throw new AddressReservationTakenError();
    }
    const created = await this.accounts.createPasswordlessIn(unitOfWork, {
      email,
      name: deriveNameFromEmail(email),
      locale,
      audience,
    });
    await this.ledger.finishAccountReservation(
      unitOfWork,
      reservation.reservation,
    );
    return created;
  }

  async hasAccountAtAddress(email: string): Promise<boolean> {
    return (await this.accounts.findByEmail(email)) !== null;
  }

  invalidNativeLink(): AppException {
    this.logger.warn('Magic link rejected: native link token is invalid');
    return new AppException(
      ErrorCode.MAGIC_LINK_INVALID,
      MAGIC_LINK_INVALID_MESSAGE,
      HttpStatus.BAD_REQUEST,
    );
  }

  private nativeCallback(
    callbackUri: string,
    attemptId: string,
    token: string,
    state: string,
  ): string {
    const callback = new URL(callbackUri);
    callback.searchParams.set(
      NATIVE_EMAIL_CALLBACK_PARAM.ATTEMPT_ID,
      attemptId,
    );
    callback.searchParams.set(NATIVE_EMAIL_CALLBACK_PARAM.EMAIL_TOKEN, token);
    callback.searchParams.set(NATIVE_EMAIL_CALLBACK_PARAM.STATE, state);
    return callback.toString();
  }

  private deferLink(
    recipient: MailRecipient,
    callback: string,
    expiresAt: Date,
    requestId: string,
  ): void {
    this.dispatcher.dispatch(async () => {
      const remainingMs = Math.max(
        0,
        expiresAt.getTime() - this.clock.now().getTime(),
      );
      const expiresInMinutes = Math.floor(
        remainingMs / MILLISECONDS_PER_MINUTE,
      );
      const sent = await this.authMail.sendMagicLink(
        recipient,
        callback,
        expiresInMinutes,
      );
      if (sent) this.logger.log(`Magic link sent requestId=${requestId}`);
    }, SIGN_IN_LINK_EMAIL_FAILED_MESSAGE);
  }
}
