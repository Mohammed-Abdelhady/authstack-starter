import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';

export async function hasPostgresAccountAudience(
  unitOfWork: UnitOfWork,
  environment: string,
): Promise<boolean> {
  const application = await postgresTransactionOf(unitOfWork)
    .selectFrom('applications')
    .select('client_id')
    .where('environment', '=', environment)
    .where('account_audience', 'is not', null)
    .limit(1)
    .executeTakeFirst();
  return application !== undefined;
}
