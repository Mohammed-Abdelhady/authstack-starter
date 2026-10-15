import {
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
} from '../../../src/common/persistence/address-ledger';
import {
  AddressClaimInput,
  AddressClaimResult,
} from '../../../src/common/persistence/types/address-ledger';
import { UnitOfWorkRunner } from '../../../src/common/persistence/unit-of-work';
import { AddressLedgerHarness } from './address-ledger-harness';

export const ADDRESS = 'foo@example.com';
export const FIRST_OWNER = 'first-owner';
export const SECOND_OWNER = 'second-owner';
export const LAPSE_MS = 60_000;

export class AddressTaken extends Error {}

export function claimInput(
  harness: AddressLedgerHarness,
  owner = FIRST_OWNER,
  address = ADDRESS,
): AddressClaimInput {
  return {
    address,
    owner,
    kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
    lapsesAt: new Date(harness.clock.now().getTime() + LAPSE_MS),
    now: harness.clock.now(),
  };
}

/** A refused claim must leave through rollback, including duplicate upserts. */
export async function claim(
  harness: AddressLedgerHarness,
  input = claimInput(harness),
  runner: UnitOfWorkRunner = harness.runner(),
): Promise<AddressClaimResult> {
  try {
    return await runner.run(async (uow) => {
      const result = await harness.ledger.claim(uow, input);
      if (result === ADDRESS_CLAIM_RESULT.TAKEN) throw new AddressTaken();
      return result;
    });
  } catch (error) {
    if (error instanceof AddressTaken) return ADDRESS_CLAIM_RESULT.TAKEN;
    throw error;
  }
}
