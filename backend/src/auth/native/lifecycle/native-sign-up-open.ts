import type { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import { storeFailureCause } from '../../../common/persistence/store-failure';
import type { AccountCreationPolicy } from '../../services/registration/account-creation-policy';
import { AccountCreationRefusedError } from '../../services/registration/account-creation-refused.error';
import type { AccountCreationMethod } from '../../types/account-creation';

export async function nativeSignUpOpen(
  runner: UnitOfWorkRunner,
  policy: AccountCreationPolicy,
  clientId: string,
  method: AccountCreationMethod,
): Promise<boolean> {
  try {
    await runner.run((work) =>
      policy.assertMayCreate({ application: clientId, method }, work),
    );
    return true;
  } catch (error) {
    if (storeFailureCause(error) instanceof AccountCreationRefusedError)
      return false;
    throw error;
  }
}
