import { Logger } from '@nestjs/common';
import {
  MagicLinkAccount,
  MagicLinkAccounts,
} from './stores/magic-link-accounts';
import { SupportedLocale } from '../../common/constants/locales';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import {
  ACCOUNT_RESERVATION_RESULT,
  AddressLedger,
} from '../../common/persistence/address-ledger';
import { AddressReservationTakenError } from '../../common/persistence/address-reservation-taken.error';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { Clock } from '../../common/services/clock';
import { AppException } from '../../common/exceptions/app.exception';
import { AccountCreationPolicy } from '../services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { deriveNameFromEmail } from './utils/magic-link-token.util';

export class MagicLinkAccountCreation {
  private readonly logger = new Logger('MagicLinkService');

  constructor(
    private readonly accounts: MagicLinkAccounts,
    private readonly runner: UnitOfWorkRunner,
    private readonly policy: AccountCreationPolicy,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
    private readonly invalidLink: () => AppException,
  ) {}

  async createUser(
    email: string,
    locale: SupportedLocale,
  ): Promise<MagicLinkAccount> {
    try {
      const user = await this.runner.run(async (unitOfWork) => {
        await this.policy.assertMayCreate(
          {
            application: WEB_CLIENT_ID,
            method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
          },
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
        });
        await this.ledger.finishAccountReservation(
          unitOfWork,
          reservation.reservation,
        );
        return created;
      });

      this.logger.log('Created a new account from a magic link');
      return user;
    } catch (error) {
      if (!(error instanceof UniqueConflictError)) {
        throw error;
      }

      // Two links for the same new address were spent at once.
      const created = await this.accounts.findByEmail(email);
      if (!created) {
        if (error instanceof AddressReservationTakenError) {
          throw this.invalidLink();
        }
        // Still the database's own refusal, which is what the global filter
        // answers with a conflict.
        throw error.cause instanceof Error ? error.cause : error;
      }
      if (error instanceof AddressReservationTakenError) {
        if (created.isDeleted) throw this.invalidLink();
        if (!created.isVerified) await this.accounts.markVerified(created);
      }
      return created;
    }
  }
}
