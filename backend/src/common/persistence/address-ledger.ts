import { randomUUID } from 'node:crypto';
import { storedAddress } from './stored-address';
import {
  AccountReservationResult,
  AddressAvailability,
  AddressClaimInput,
  AddressClaimResult,
  AddressLookup,
  AddressRelease,
  OwnedAddressLookup,
} from './types/address-ledger';
import { UnitOfWork } from './unit-of-work';

export const ADDRESS_CLAIM_KIND = {
  ACCOUNT: 'ACCOUNT',
  EMAIL_CHANGE: 'EMAIL_CHANGE',
  INVITATION: 'INVITATION', // feature:invitations
} as const;

export const ADDRESS_CLAIM_RESULT = {
  CLAIMED: 'claimed',
  TAKEN: 'taken',
} as const;

export const ACCOUNT_RESERVATION_RESULT = {
  RESERVED: 'reserved',
  TAKEN: 'taken',
} as const;

/** A taken result must leave the caller's UOW through rollback. */
export abstract class AddressLedger {
  abstract claim(
    uow: UnitOfWork,
    input: AddressClaimInput,
  ): Promise<AddressClaimResult>;

  /** Locks an existing live claim until the caller's unit of work ends. */
  abstract holdsLiveClaim(
    uow: UnitOfWork,
    input: OwnedAddressLookup,
  ): Promise<boolean>;

  async reserveForAccount(
    uow: UnitOfWork,
    input: AddressLookup,
  ): Promise<AccountReservationResult> {
    const reservation = {
      address: storedAddress(input.address),
      owner: randomUUID(),
    };
    const result = await this.claim(uow, {
      ...reservation,
      kind: ADDRESS_CLAIM_KIND.ACCOUNT,
      // The row only serialises writers inside this transaction.
      lapsesAt: input.now,
      now: input.now,
    });
    return result === ADDRESS_CLAIM_RESULT.TAKEN
      ? { status: ACCOUNT_RESERVATION_RESULT.TAKEN }
      : { status: ACCOUNT_RESERVATION_RESULT.RESERVED, reservation };
  }

  finishAccountReservation(
    uow: UnitOfWork,
    reservation: AddressRelease,
  ): Promise<void> {
    return this.release(uow, reservation);
  }

  abstract release(uow: UnitOfWork, input: AddressRelease): Promise<void>;
  abstract isFree(
    uow: UnitOfWork,
    input: AddressAvailability,
  ): Promise<boolean>;
}
