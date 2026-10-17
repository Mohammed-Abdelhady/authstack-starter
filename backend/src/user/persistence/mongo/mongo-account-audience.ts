import type { Connection } from 'mongoose';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import type { RoleAudience } from '../../../host/types/host-role.type';
import { mongoSessionOf } from '../../../session/persistence/mongo/mongo-unit-of-work';
import { SelfSignUpRefusedError } from '../../../auth/services/registration/self-sign-up-refused.error';
import {
  Role,
  type RoleDocument,
} from '../../../role/persistence/mongo/schemas/role.schema';

export async function assertMongoAccountAudience(
  connection: Connection,
  work: UnitOfWork,
  roleSlug: string,
  audience: RoleAudience | undefined,
): Promise<void> {
  if (audience === undefined) return;
  const roles = connection.model<RoleDocument>(Role.name);
  const role = await roles
    .findOne({ slug: roleSlug })
    .session(mongoSessionOf(work))
    .select('audience')
    .lean<{ audience?: RoleAudience | null }>()
    .exec();
  if (!role || role.audience !== audience) throw new SelfSignUpRefusedError();
}
