import { AddressReservationTakenError } from '../../common/persistence/address-reservation-taken.error';
import { ACCOUNT_RESERVATION_RESULT } from '../../common/persistence/address-ledger';
import type { SupportedLocale } from '../../common/constants/locales';
import { UserRole } from '../../user/enums/user-role.enum';
import type { StoredAccount } from '../../user/stores/stored-account';
import { ACCOUNT_CREATION_METHOD } from '../constants/account-creation';
import type { OAuthProfile } from './oauth-provider.interface';
import type { ProviderAccountCreation } from './types/provider-account-creation';

export function createProviderAccount(
  dependencies: ProviderAccountCreation,
  identity: { provider: string; providerId: string },
  profile: OAuthProfile,
  locale: SupportedLocale,
  application: string,
): Promise<StoredAccount> {
  const { accounts, policy, ledger, clock } = dependencies;
  return dependencies.runner.run(async (unitOfWork) => {
    const audience = await policy.assertMayCreate(
      { application, method: ACCOUNT_CREATION_METHOD.PROVIDER },
      unitOfWork,
    );
    const reservation = await ledger.reserveForAccount(unitOfWork, {
      address: profile.email,
      now: clock.now(),
    });
    if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN) {
      throw new AddressReservationTakenError();
    }
    const created = await accounts.createFromProviderIn(unitOfWork, {
      ...identity,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      role: UserRole.USER,
      locale,
      audience,
    });
    await ledger.finishAccountReservation(unitOfWork, reservation.reservation);
    return created;
  });
}
