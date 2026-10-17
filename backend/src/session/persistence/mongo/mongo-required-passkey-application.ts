import type { Model } from 'mongoose';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import { linearizable } from '../../../common/persistence/mongo/linearizable-query';
import type { ApplicationDocument } from './schemas/application.schema';

export async function readMongoRequiredPasskeyApplication(
  applications: Model<ApplicationDocument>,
  environment: string,
): Promise<string | null> {
  const application = await singleStatement(() =>
    linearizable(applications.findOne({ environment, requirePasskey: true }))
      .select('clientId')
      .exec(),
  );
  return application?.clientId ?? null;
}
