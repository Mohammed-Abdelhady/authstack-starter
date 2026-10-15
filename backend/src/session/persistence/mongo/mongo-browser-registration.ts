import type { Model } from 'mongoose';
import type { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { RetryableAbortError } from '../../../common/persistence/persistence-errors';
import { isMongoDuplicateKeyError } from '../../../common/persistence/mongo/mongo-error.util';
import type { BrowserRegistration } from '../../applications/types/browser-registration';
import type { ApplicationDocument } from './schemas/application.schema';
import { mongoApplicationPolicyFields } from './mongo-application-policy-fields';
import { mongoSessionOf } from './mongo-unit-of-work';

/** The Mongo runner retries labelled failures before mapping shared errors. */
class BrowserRegistrationRetry extends RetryableAbortError {
  readonly errorLabels = ['TransientTransactionError'];
}

export async function storeMongoBrowserRegistration(
  model: Model<ApplicationDocument>,
  work: UnitOfWork,
  registration: BrowserRegistration,
): Promise<void> {
  const { accountAudience, ...policy } = registration;
  const fields = {
    ...mongoApplicationPolicyFields(policy),
    accountAudience,
    sessionCap: registration.sessionCap ?? null,
    displayName: registration.displayName,
    allowedOrigins: registration.allowedOrigins,
    'policy.absoluteLifetimeMs': registration.policy.absoluteLifetimeMs,
    'policy.idleLifetimeMs': registration.policy.idleLifetimeMs,
    ...(registration.enabled === undefined
      ? {}
      : { enabled: registration.enabled }),
  };
  const session = mongoSessionOf(work);
  if (registration.expectedPolicyVersion === null) {
    try {
      await model.create(
        [
          {
            clientId: registration.clientId,
            environment: registration.environment,
            platform: registration.platform,
            clientType: registration.clientType,
            enabled: registration.enabled ?? true,
            sessionVersion: 0,
            policyVersion: registration.policyVersion,
            redirectUris: [],
            audiences: registration.initialAudiences,
            allowedScopes: registration.initialScopes,
            signUp: registration.signUp,
            requirePasskey: registration.requirePasskey,
            signInMethods: registration.signInMethods,
            accountAudience,
            sessionCap: registration.sessionCap,
            policy: registration.policy,
            displayName: registration.displayName,
            allowedOrigins: registration.allowedOrigins,
          },
        ],
        { session },
      );
    } catch (error) {
      if (isMongoDuplicateKeyError(error))
        throw new BrowserRegistrationRetry(error);
      throw error;
    }
    return;
  }
  const version = registration.expectedPolicyVersion;
  const updated = await model
    .updateOne(
      {
        clientId: registration.clientId,
        environment: registration.environment,
        platform: registration.platform,
        clientType: registration.clientType,
        $or: [
          { policyVersion: version },
          ...(version === 0 ? [{ policyVersion: null }] : []),
        ],
      },
      { $set: fields },
      { session },
    )
    .exec();
  if (updated.matchedCount !== 1) throw new BrowserRegistrationRetry();
}
