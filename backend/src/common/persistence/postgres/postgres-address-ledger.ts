import { ADDRESS_CLAIM_RESULT, AddressLedger } from '../address-ledger';
import { storedAddress } from '../stored-address';
import {
  AddressClaimInput,
  AddressClaimResult,
  AddressAvailability,
  AddressRelease,
} from '../types/address-ledger';
import { UnitOfWork } from '../unit-of-work';
import { postgresTransactionOf } from './postgres-unit-of-work';

export class PostgresAddressLedger extends AddressLedger {
  async claim(
    uow: UnitOfWork,
    input: AddressClaimInput,
  ): Promise<AddressClaimResult> {
    const transaction = postgresTransactionOf(uow);
    const address = storedAddress(input.address);
    const row = await transaction
      .insertInto('address_claims')
      .values({
        address,
        kind: input.kind,
        owner: input.owner,
        lapses_at: input.lapsesAt,
      })
      .onConflict((conflict) =>
        conflict
          .column('address')
          .doUpdateSet({
            kind: input.kind,
            owner: input.owner,
            lapses_at: input.lapsesAt,
          })
          .where((eb) =>
            eb.or([
              eb('address_claims.lapses_at', '<=', input.now),
              eb('address_claims.owner', '=', input.owner),
            ]),
          ),
      )
      .returning('owner')
      .executeTakeFirst();
    if (!row) return ADDRESS_CLAIM_RESULT.TAKEN;

    // A new read-committed statement sees accounts committed during the wait.
    const account = await transaction
      .selectFrom('users')
      .select('id')
      .where('email', '=', address)
      .executeTakeFirst();
    return account && account.id !== input.owner
      ? ADDRESS_CLAIM_RESULT.TAKEN
      : ADDRESS_CLAIM_RESULT.CLAIMED;
  }

  async release(uow: UnitOfWork, input: AddressRelease): Promise<void> {
    await postgresTransactionOf(uow)
      .deleteFrom('address_claims')
      .where('address', '=', storedAddress(input.address))
      .where('owner', '=', input.owner)
      .execute();
  }

  async isFree(uow: UnitOfWork, input: AddressAvailability): Promise<boolean> {
    const transaction = postgresTransactionOf(uow);
    const address = storedAddress(input.address);
    const account = await transaction
      .selectFrom('users')
      .select('id')
      .where('email', '=', address)
      .executeTakeFirst();
    if (account) return false;
    let claims = transaction
      .selectFrom('address_claims')
      .select('owner')
      .where('address', '=', address)
      .where('lapses_at', '>', input.now);
    if (input.owner !== undefined) {
      claims = claims.where('owner', '!=', input.owner);
    }
    const claim = await claims.executeTakeFirst();
    return claim === undefined;
  }
}
