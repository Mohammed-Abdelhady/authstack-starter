import type { AddressLedger } from '../../../common/persistence/address-ledger';
import type { Clock } from '../../../common/services/clock';
import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import type { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import type { ProviderSignInStore } from '../stores/provider-sign-in.store';

export interface ProviderAccountCreation {
  readonly accounts: ProviderSignInStore;
  readonly runner: UnitOfWorkRunner;
  readonly policy: AccountCreationPolicy;
  readonly ledger: AddressLedger;
  readonly clock: Clock;
}
