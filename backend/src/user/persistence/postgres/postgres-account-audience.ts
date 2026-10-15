import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { RoleAudience } from '../../../host/types/host-role.type';
import { postgresTransactionOf } from '../../../common/persistence/postgres/postgres-unit-of-work';
import { SelfSignUpRefusedError } from '../../../auth/services/registration/self-sign-up-refused.error';

export async function assertPostgresAccountAudience(
  work: UnitOfWork,
  roleSlug: string,
  audience: RoleAudience | undefined,
): Promise<void> {
  if (audience === undefined) return;
  const role = await postgresTransactionOf(work)
    .selectFrom('roles')
    .select('audience')
    .where('slug', '=', roleSlug)
    .forShare()
    .noWait()
    .executeTakeFirst();
  if (!role || role.audience !== audience) throw new SelfSignUpRefusedError();
}
