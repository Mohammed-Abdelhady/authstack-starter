import type { Model } from 'mongoose';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import { linearizable } from '../../../common/persistence/mongo/linearizable-query';
import { APPLICATION_PLATFORM } from '../../constants/client-ids';
import type { ApplicationDocument } from './schemas/application.schema';

export async function readMongoNativeRequiredPasskey(
  applications: Model<ApplicationDocument>,
  environment: string,
): Promise<string | null> {
  const application = await singleStatement(() =>
    linearizable(
      applications.findOne({
        environment,
        platform: APPLICATION_PLATFORM.NATIVE,
        requirePasskey: true,
      }),
    )
      .select('clientId')
      .exec(),
  );
  return application?.clientId ?? null;
}
