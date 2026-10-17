import { Logger } from '@nestjs/common';
import {
  MagicLinkAccount,
  MagicLinkAccounts,
} from './stores/magic-link-accounts';
import type { AccountCreationMethod } from '../types/account-creation';
import { SupportedLocale } from '../../common/constants/locales';
import {
  UnitOfWork,
  UnitOfWorkRunner,
} from '../../common/persistence/unit-of-work';
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

export interface MagicLinkAccountCreationDependencies {
  accounts: MagicLinkAccounts;
  runner: UnitOfWorkRunner;
  policy: AccountCreationPolicy;
  ledger: AddressLedger;
  clock: Clock;
  invalidLink: () => AppException;
}

export class MagicLinkAccountCreation {
  private readonly logger = new Logger('MagicLinkService');

  constructor(
    private readonly dependencies: MagicLinkAccountCreationDependencies,
  ) {}

  async createUser(
    email: string,
    locale: SupportedLocale,
    application = WEB_CLIENT_ID,
  ): Promise<MagicLinkAccount> {
    try {
      const user = await this.dependencies.runner.run((work) =>
        this.createIn(work, {
          email,
          locale,
          application,
          method: ACCOUNT_CREATION_METHOD.MAGIC_LINK,
        }),
      );

      this.logger.log('Created a new account from a magic link');
      return user;
    } catch (error) {
      if (!(error instanceof UniqueConflictError)) {
        throw error;
      }

      // Two links for the same new address were spent at once.
      const created = await this.dependencies.accounts.findByEmail(email);
      if (!created) {
        if (error instanceof AddressReservationTakenError) {
          throw this.dependencies.invalidLink();
        }
        // Still the database's own refusal, which is what the global filter
        // answers with a conflict.
        throw error.cause instanceof Error ? error.cause : error;
      }
      if (error instanceof AddressReservationTakenError) {
        if (created.isDeleted) throw this.dependencies.invalidLink();
        if (!created.isVerified)
          await this.dependencies.accounts.markVerified(created);
      }
      return created;
    }
  }

  async createIn(
    work: UnitOfWork,
    request: {
      email: string;
      locale: SupportedLocale;
      application: string;
      method: AccountCreationMethod;
    },
  ): Promise<MagicLinkAccount> {
    const audience = await this.dependencies.policy.assertMayCreate(
      { application: request.application, method: request.method },
      work,
    );
    const reservation = await this.dependencies.ledger.reserveForAccount(work, {
      address: request.email,
      now: this.dependencies.clock.now(),
    });
    if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN)
      throw new AddressReservationTakenError();
    const created = await this.dependencies.accounts.createPasswordlessIn(
      work,
      {
        email: request.email,
        name: deriveNameFromEmail(request.email),
        locale: request.locale,
        audience,
      },
    );
    await this.dependencies.ledger.finishAccountReservation(
      work,
      reservation.reservation,
    );
    return created;
  }
}
