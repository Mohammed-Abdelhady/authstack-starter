import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailChangeCodeTarget,
  PreparedEmailChange,
} from '../../types/prepared-email-change';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { HashService } from '../../../common/services/hash.service';
import { Clock } from '../../../common/services/clock';
import { currentRequestId } from '../../../common/context/request-context';
import { activationCodeInvalid } from '../../utils/activation-error.util';
import { generateVerificationCode } from '../../utils/verification-code.util';
import { PendingRegistrationIssuer } from './pending-registration-issuer';
import {
  CODE_CLAIM,
  CodeRotation,
  PendingRegistrationStore,
} from '../../pending-codes/pending-registration.store';
import { MailCounterService } from '../mail/mail-counter.service';
import {
  CODE_GUESS_RULE,
  PENDING_PURPOSE,
  PendingPurpose,
} from '../../constants/registration';
import {
  IssuedCode,
  IssuedCodeWithGeneration,
  RegistrationDetails,
  ReservedCode,
} from '../../interfaces/pending-code.interface';

/**
 * Activation code verification: reserve an attempt, compare the code once,
 * and consume the exact generation inside the caller's unit of work. Opening
 * and refreshing records is the issuer's responsibility, and the per-address
 * mail cap is the mail counter's.
 */
@Injectable()
export class VerificationCodeService {
  private readonly logger = new Logger(VerificationCodeService.name);
  private readonly maxAttempts: number;
  private readonly issuer: PendingRegistrationIssuer;

  constructor(
    private readonly store: PendingRegistrationStore,
    private readonly hashService: HashService,
    configService: ConfigService,
    private readonly clock: Clock,
    private readonly mailCounterService: MailCounterService,
  ) {
    this.maxAttempts = configService.get<number>('activation.maxAttempts', 5);
    this.issuer = new PendingRegistrationIssuer(
      this.store,
      this.hashService,
      configService,
      clock,
    );
  }

  codeExpiresAt(now: Date): Date {
    return this.issuer.codeExpiresAt(now);
  }

  async prepareEmailChange(
    email: string,
    details: EmailChangeCodeTarget,
  ): Promise<PreparedEmailChange | null> {
    const underCap = await this.mailCounterService.tryRecord(
      email,
      PENDING_PURPOSE.EMAIL_CHANGE,
    );
    if (!underCap) {
      await this.spendCodeHashingTime();
      return null;
    }
    return this.issuer.prepareEmailChange(email, details);
  }

  storeEmailChangeIn(
    uow: UnitOfWork,
    prepared: PreparedEmailChange,
  ): Promise<CodeRotation> {
    return this.store.putEmailChangeCodeIn(
      uow,
      prepared.email,
      prepared.generation,
    );
  }

  /**
   * Open or refresh the pending record for an address and purpose. Returns
   * null when the address already had its allowance of mailed codes.
   */
  async createOrUpdatePendingRegistration(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails = {},
  ): Promise<IssuedCode | null> {
    const issued = await this.createPendingGeneration(email, purpose, details);
    return issued ? { code: issued.code } : null;
  }

  /** Same issue path, with a private commitment for a native attempt. */
  async createOrUpdatePendingRegistrationWithGeneration(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails = {},
  ): Promise<IssuedCodeWithGeneration | null> {
    return this.createPendingGeneration(email, purpose, details);
  }

  private async createPendingGeneration(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails,
  ): Promise<IssuedCodeWithGeneration | null> {
    const underCap = await this.mailCounterService.tryRecord(email, purpose);
    if (!underCap) {
      await this.spendCodeHashingTime();
      return null;
    }

    const stored = await this.issuer.createOrUpdateWithGeneration(
      email,
      purpose,
      details,
    );
    if (stored !== null) {
      this.logger.log(
        `Opened ${purpose} code requestId=${currentRequestId() ?? 'unknown'}`,
      );
    }
    return stored;
  }

  /**
   * Reissue the code of an existing pending record. Returns null when nothing
   * was mailed, so every caller answers the generic reply.
   */
  async resendActivationCode(
    email: string,
    purpose: PendingPurpose,
    details: RegistrationDetails = {},
  ): Promise<IssuedCode | null> {
    const underCap = await this.mailCounterService.tryRecord(email, purpose);
    if (!underCap) {
      await this.spendCodeHashingTime();
      return null;
    }

    const stored = await this.issuer.resend(email, purpose, details);
    if (stored !== null) {
      this.logger.log(
        `Resent ${purpose} code requestId=${currentRequestId() ?? 'unknown'}`,
      );
    }
    return stored;
  }

  /**
   * Reserve one attempt, then compare the code exactly once on every path.
   * A wrong, missing, expired, exhausted or superseded code answers the one
   * shared failure; the dummy comparison keeps the timing the same.
   *
   * @param email - Address the code was sent to
   * @param code - Code the caller submitted
   * @param purpose - Which kind of pending record the code must belong to
   * @throws AppException ACTIVATION_CODE_INVALID for every failing state
   */
  async verifyCode(
    email: string,
    code: string,
    purpose: PendingPurpose,
  ): Promise<ReservedCode> {
    const now = this.clock.now();
    const reserved = await this.store.reserveAttempt(
      { email, purpose },
      { now, maxAttempts: this.maxAttempts, guesses: CODE_GUESS_RULE },
    );

    if (!reserved) {
      await this.store.dropExpiredRecord({ email, purpose }, now);
      await this.hashService.spendComparison(code);
      throw activationCodeInvalid();
    }

    const isCodeValid = await this.hashService.compare(
      code,
      reserved.hashedCode,
    );
    if (!isCodeValid) {
      throw activationCodeInvalid();
    }

    return {
      id: reserved.id,
      email: reserved.email,
      purpose,
      hashedCode: reserved.hashedCode,
      userId: reserved.userId,
      addressGeneration: reserved.addressGeneration,
    };
  }

  /**
   * Delete exactly the generation that was compared, inside the caller's
   * unit of work. A resend or a new registration changes hashedCode, so the
   * stale caller matches nothing and the unit of work rolls back.
   *
   * @param reserved - The record returned by verifyCode
   * @param unitOfWork - Unit of work the delete must join
   * @returns True when this caller consumed the generation
   */
  async consumeCode(
    reserved: ReservedCode,
    unitOfWork: UnitOfWork,
  ): Promise<boolean> {
    const claim = await this.store.claimCode(unitOfWork, {
      id: reserved.id.toString(),
      purpose: reserved.purpose,
      hashedCode: reserved.hashedCode,
      now: this.clock.now(),
    });
    return claim === CODE_CLAIM.CLAIMED;
  }

  /**
   * Spend the one code-hash every path through the open and resend methods
   * costs. The store hashes the code it opens; an over-cap answer never reaches
   * the store, so it spends the same cost here. Without it an over-cap answer
   * is milliseconds faster than one that opens a record, which tells an address
   * with an account from a free one.
   */
  private async spendCodeHashingTime(): Promise<void> {
    await this.hashService.hash(generateVerificationCode());
  }
}
