import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { singleStatement } from '../../../common/persistence/mongo/mongo-unique-conflict';
import { UnitOfWork } from '../../../common/persistence/unit-of-work';
import { isMongoDuplicateKeyError } from '../../../common/persistence/mongo/mongo-error.util';
import {
  ApplicationRegistryStore,
  FirstPartyKey,
  FirstPartyRegistration,
  NativeRegistration,
  RegisteredApplication,
  RegisteredClient,
  StoredRegistration,
} from '../../applications/application-registry.store';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../constants/client-ids';
import { Application, ApplicationDocument } from './schemas/application.schema';
import { linearizable } from '../../../common/persistence/mongo/linearizable-query';
import {
  toRegisteredApplication,
  toRegisteredClient,
} from './mongo-application-records';
import { mongoSessionOf } from './mongo-unit-of-work';

const PUBLIC_NATIVE = {
  platform: APPLICATION_PLATFORM.NATIVE,
  clientType: APPLICATION_CLIENT_TYPE.PUBLIC,
} as const;

/**
 * A committed authority read is a linearizable read on the primary. A
 * reconciliation takes the registry at its first write: that write conflicts
 * with any other open transaction that wrote the same application, and MongoDB
 * refuses the later writer at once.
 *
 * Inside a unit of work the driver's own error leaves as raised: the runner
 * that owns the transaction maps it, and reads its labels to decide a rerun.
 */
@Injectable()
export class MongoApplicationRegistryStore extends ApplicationRegistryStore {
  constructor(
    @InjectModel(Application.name)
    private readonly applicationModel: Model<ApplicationDocument>,
  ) {
    super();
  }

  async readCommittedApplication(
    environment: string,
    clientId: string,
  ): Promise<RegisteredApplication | null> {
    const application = await singleStatement(() =>
      linearizable(
        this.applicationModel.findOne({ clientId, environment }),
      ).exec(),
    );
    return application ? toRegisteredApplication(application) : null;
  }

  async readCommittedApplications(
    environment: string,
    clientIds: string[],
  ): Promise<RegisteredApplication[]> {
    const applications = await singleStatement(() =>
      linearizable(
        this.applicationModel.find({
          clientId: { $in: clientIds },
          environment,
        }),
      ).exec(),
    );
    return applications.map(toRegisteredApplication);
  }

  async findApplication(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<RegisteredApplication | null> {
    const application = await this.applicationModel
      .findOne({ clientId, environment })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return application ? toRegisteredApplication(application) : null;
  }

  async findApplications(
    unitOfWork: UnitOfWork,
    environment: string,
    clientIds: string[],
  ): Promise<RegisteredApplication[]> {
    const applications = await this.applicationModel
      .find({ clientId: { $in: clientIds }, environment })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return applications.map(toRegisteredApplication);
  }

  async lookUpClient(
    environment: string,
    clientId: string,
  ): Promise<RegisteredClient | null> {
    const application = await singleStatement(() =>
      this.applicationModel.findOne({ clientId, environment }).exec(),
    );
    return application ? toRegisteredClient(application) : null;
  }

  async findClient(
    unitOfWork: UnitOfWork,
    environment: string,
    clientId: string,
  ): Promise<RegisteredClient | null> {
    const application = await this.applicationModel
      .findOne({ clientId, environment })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return application ? toRegisteredClient(application) : null;
  }

  async registerFirstParty(
    registration: FirstPartyRegistration,
  ): Promise<void> {
    await singleStatement(() =>
      this.applicationModel.updateOne(
        {
          clientId: registration.clientId,
          environment: registration.environment,
        },
        {
          $setOnInsert: {
            clientId: registration.clientId,
            environment: registration.environment,
            enabled: true,
            sessionVersion: 0,
            policyVersion: 0,
            redirectUris: [],
            audiences: registration.initialAudiences,
            allowedScopes: registration.initialScopes,
          },
          $set: {
            displayName: registration.displayName,
            platform: registration.platform,
            clientType: registration.clientType,
            allowedOrigins: registration.allowedOrigins,
            policy: registration.policy,
          },
        },
        { upsert: true },
      ),
    );
  }

  async allowOrigin(
    environment: string,
    applications: FirstPartyKey[],
    origin: string,
  ): Promise<void> {
    await singleStatement(() =>
      this.applicationModel
        .updateMany(
          {
            environment,
            $or: applications.map(({ clientId, platform }) => ({
              clientId,
              platform,
            })),
          },
          { $addToSet: { allowedOrigins: origin } },
        )
        .exec(),
    );
  }

  async takeRegistrations(
    unitOfWork: UnitOfWork,
    environment: string,
    clientIds: string[],
  ): Promise<StoredRegistration[]> {
    if (clientIds.length === 0) {
      return [];
    }
    const stored = await this.applicationModel
      .find({ clientId: { $in: clientIds }, environment })
      .session(mongoSessionOf(unitOfWork))
      .exec();
    return stored.map((application) => ({
      clientId: application.clientId,
      platform: application.platform,
      clientType: application.clientType,
      enabled: application.enabled,
      redirectUris: [...application.redirectUris],
    }));
  }

  async storeNativeRegistration(
    unitOfWork: UnitOfWork,
    registration: NativeRegistration,
  ): Promise<void> {
    const session = mongoSessionOf(unitOfWork);
    const filter = {
      clientId: registration.clientId,
      environment: registration.environment,
      ...PUBLIC_NATIVE,
    };
    const update = nativeRegistrationUpdate(registration);
    try {
      await this.applicationModel
        .updateOne(filter, update, { upsert: true, session })
        .exec();
    } catch (error) {
      if (!isMongoDuplicateKeyError(error)) {
        throw error;
      }
      // The client id was taken after this unit of work looked. The refused
      // insert has aborted the transaction, so this statement raises the
      // driver's own retryable error and the runner reruns the reconciliation.
      const result = await this.applicationModel
        .updateOne(filter, update, { session })
        .exec();
      if (result.matchedCount !== 1) {
        throw error;
      }
    }
  }

  async disableNativeApplicationsExcept(
    unitOfWork: UnitOfWork,
    environment: string,
    keptClientIds: string[],
  ): Promise<void> {
    await this.applicationModel
      .updateMany(
        {
          environment,
          platform: APPLICATION_PLATFORM.NATIVE,
          enabled: { $ne: false },
          clientId: { $nin: keptClientIds },
        },
        { $set: { enabled: false }, $inc: { sessionVersion: 1 } },
        { session: mongoSessionOf(unitOfWork) },
      )
      .exec();
  }
}

/** A pipeline, so the version advances from the stored value in one write. */
function nativeRegistrationUpdate(registration: NativeRegistration) {
  return [
    {
      $set: {
        clientId: { $literal: registration.clientId },
        environment: { $literal: registration.environment },
        displayName: { $literal: registration.displayName },
        ...PUBLIC_NATIVE,
        enabled: true,
        redirectUris: { $literal: registration.redirectUris },
        allowedOrigins: [],
        audiences: { $literal: registration.audiences },
        allowedScopes: { $literal: registration.allowedScopes },
        createdAt: { $ifNull: ['$createdAt', '$$NOW'] },
        policy: {
          absoluteLifetimeMs: registration.policy.absoluteLifetimeMs,
          idleLifetimeMs: registration.policy.idleLifetimeMs,
        },
        sessionVersion: {
          $add: [
            { $ifNull: ['$sessionVersion', 0] },
            registration.endsSessions ? 1 : 0,
          ],
        },
        policyVersion: { $ifNull: ['$policyVersion', 0] },
      },
    },
  ];
}
