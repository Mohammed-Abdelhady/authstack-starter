import { Kysely } from 'kysely';
import { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { postgresTransactionOf } from '../../../../common/persistence/postgres/postgres-unit-of-work';
import { UnitOfWork } from '../../../../common/persistence/unit-of-work';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { SecondFactorAccount } from '../../stores/second-factor-account';
import { SPEND_OUTCOME, SpendOutcome } from '../../stores/second-factor.store';
import { autocommit } from '../../../persistence/postgres/postgres-pending-codes-database';

const NO_CONSTRAINTS: Readonly<Record<string, string>> = {};

export function spendPostgresTotpStep(
  database: Kysely<PostgresTables>,
  account: SecondFactorAccount,
  step: number,
  unitOfWork?: UnitOfWork,
): Promise<SpendOutcome> {
  const spend = async (connection: Kysely<PostgresTables>) => {
    const spent = await connection
      .updateTable('user_two_factor')
      .set({ last_used_step: step })
      .where('user_id', '=', toUuid(account.id))
      .where((state) =>
        account.twoFactor.lastUsedStep === null
          ? state('last_used_step', 'is', null)
          : state('last_used_step', '=', account.twoFactor.lastUsedStep),
      )
      .executeTakeFirst();
    return spent.numUpdatedRows === 1n
      ? SPEND_OUTCOME.SPENT
      : SPEND_OUTCOME.ALREADY_SPENT;
  };
  return unitOfWork
    ? spend(postgresTransactionOf(unitOfWork))
    : autocommit(NO_CONSTRAINTS, () => spend(database));
}

export function spendPostgresRecoveryCode(
  database: Kysely<PostgresTables>,
  account: SecondFactorAccount,
  hash: string,
  usedAt: Date,
  unitOfWork?: UnitOfWork,
): Promise<SpendOutcome> {
  const spend = async (connection: Kysely<PostgresTables>) => {
    const spent = await connection
      .updateTable('user_recovery_codes')
      .set({ used_at: usedAt })
      .where('user_id', '=', toUuid(account.id))
      .where('hash', '=', hash)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    return spent.numUpdatedRows === 1n
      ? SPEND_OUTCOME.SPENT
      : SPEND_OUTCOME.ALREADY_SPENT;
  };
  return unitOfWork
    ? spend(postgresTransactionOf(unitOfWork))
    : autocommit(NO_CONSTRAINTS, () => spend(database));
}
