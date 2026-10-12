import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { SecondFactorAccount } from '../../stores/second-factor-account';
import { SecondFactorConfirmation } from '../../stores/second-factor.store';

/** Guard the pending state and its recovery codes in the session transaction. */
export async function confirmSecondFactorIn(
  unitOfWork: UnitOfWork,
  account: SecondFactorAccount,
  confirmation: SecondFactorConfirmation,
): Promise<boolean> {
  const secret = account.twoFactor.secret;
  if (!secret) return false;
  const work = postgresTransactionOf(unitOfWork);
  const userId = toUuid(account.id);
  const confirmed = await work
    .updateTable('user_two_factor')
    .set({ enabled: true, confirmed_at: confirmation.confirmedAt })
    .where('user_id', '=', userId)
    .where('enabled', '=', false)
    .where('secret_ciphertext', '=', secret.ciphertext)
    .executeTakeFirst();
  if (confirmed.numUpdatedRows !== 1n) return false;

  await work
    .deleteFrom('user_recovery_codes')
    .where('user_id', '=', userId)
    .execute();
  await work
    .insertInto('user_recovery_codes')
    .values(
      confirmation.recoveryCodeHashes.map((hash) => ({
        user_id: userId,
        hash,
      })),
    )
    .execute();
  return true;
}
