import {
  ADDRESS_CLAIM_KIND,
  ADDRESS_CLAIM_RESULT,
  AddressLedger,
} from '../../src/common/persistence/address-ledger';
import { UnitOfWorkRunner } from '../../src/common/persistence/unit-of-work';
import { Clock } from '../../src/common/services/clock';

const CLAIM_LIFETIME_MS = 900_000;
export const CLAIM_OWNER = 'another-address-owner';

export async function holdAddress(
  ledger: AddressLedger,
  runner: UnitOfWorkRunner,
  clock: Clock,
  address: string,
  owner = CLAIM_OWNER,
): Promise<void> {
  const now = clock.now();
  await runner.run(async (uow) => {
    const result = await ledger.claim(uow, {
      address,
      owner,
      kind: ADDRESS_CLAIM_KIND.EMAIL_CHANGE,
      now,
      lapsesAt: new Date(now.getTime() + CLAIM_LIFETIME_MS),
    });
    if (result === ADDRESS_CLAIM_RESULT.TAKEN) {
      throw new Error('address claim fixture was refused');
    }
  });
}
