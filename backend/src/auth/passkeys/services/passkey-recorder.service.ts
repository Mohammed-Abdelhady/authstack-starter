import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { EnrolmentPromotion } from '../../contracts/enrolment-promotion';
import type { PromotedEnrolmentSession } from '../../contracts/types/enrolment-promotion';
import { PasskeyAccounts } from '../stores/passkey-accounts';
import {
  NewPasskey,
  PasskeyStore,
  StoredPasskey,
} from '../stores/passkey.store';

/** The session a registration was made on, and what it verified. */
export interface RegistrationContext {
  readonly sessionId: string;
  readonly clientId: string;
  /** The authenticator verified its user before it made the credential. */
  readonly userVerified: boolean;
}

/** A stored passkey, and the full session an enrolment registration became. */
export interface RecordedPasskey {
  readonly passkey: StoredPasskey;
  /** Present only once the unit of work that promoted the enrolment committed. */
  readonly promoted?: PromotedEnrolmentSession;
}

/**
 * Stores a verified registration. The account is read again, the passkey is
 * inserted and the enrolment promotion joins, all in one unit of work: an
 * account deactivated after its options were handed out gets no passkey, and
 * a promotion that refuses leaves none stored. A refusal the promotion has to
 * record is written after the rollback.
 */
@Injectable()
export class PasskeyRecorder {
  private readonly logger = new Logger(PasskeyRecorder.name);

  constructor(
    private readonly passkeys: PasskeyStore,
    private readonly accounts: PasskeyAccounts,
    private readonly runner: UnitOfWorkRunner,
    private readonly promotion: EnrolmentPromotion,
  ) {}

  /**
   * @throws AppException PASSKEY_VERIFICATION_FAILED when the account is gone
   * or deactivated
   * @throws UniqueConflictError when another passkey has the credential id
   * @throws whatever the enrolment promotion refuses with, after the rollback
   */
  record(
    passkey: NewPasskey,
    context: RegistrationContext,
  ): Promise<RecordedPasskey> {
    return this.promotion.withRefusalRecorded(() =>
      this.runner.run(async (unitOfWork) => {
        const standing = await this.accounts.readStanding(
          unitOfWork,
          passkey.userId,
        );
        if (!standing || standing.isDeleted) {
          this.logger.warn('Passkey registration refused: account deactivated');
          throw new AppException(
            ErrorCode.PASSKEY_VERIFICATION_FAILED,
            'That passkey could not be registered',
            HttpStatus.UNAUTHORIZED,
          );
        }
        const stored = await this.passkeys.insert(passkey, unitOfWork);
        await this.promotion.promoteAfterFirstPasskey(unitOfWork, {
          sessionId: context.sessionId,
          userId: passkey.userId,
          clientId: context.clientId,
          proof: {
            userId: passkey.userId,
            rpId: passkey.rpId,
            credentialId: stored.credentialId,
            userVerified: context.userVerified,
          },
        });
        return {
          passkey: stored,
          promoted: this.promotion.takePromotedSessionIn(unitOfWork),
        };
      }),
    );
  }
}
