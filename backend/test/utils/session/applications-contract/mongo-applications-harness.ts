import { Types } from 'mongoose';
import { ApplicationAccessStore } from '../../../../src/session/applications/application-access.store';
import { ApplicationRegistryStore } from '../../../../src/session/applications/application-registry.store';
import { bootMongoAuthority } from '../authority-contract/mongo-authority-harness';
import { ApplicationsContractHarness } from './applications-contract-harness';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

export async function bootMongoApplicationsHarness(): Promise<ApplicationsContractHarness> {
  const { harness: authority, booted } = await bootMongoAuthority(
    'applications_contract',
  );
  const { app, applications, grants } = booted;

  return {
    authority,
    registryStore: app.get(ApplicationRegistryStore),
    accessStore: app.get(ApplicationAccessStore),

    storedApplications: async () => {
      const stored = await applications
        .find({})
        .sort({ environment: 1, clientId: 1 })
        .lean()
        .exec();
      return stored.map((application) => ({
        clientId: application.clientId,
        environment: application.environment,
        displayName: application.displayName,
        platform: application.platform,
        clientType: application.clientType,
        enabled: application.enabled,
        redirectUris: application.redirectUris,
        allowedOrigins: application.allowedOrigins,
        audiences: application.audiences,
        allowedScopes: application.allowedScopes,
        absoluteLifetimeMs: application.policy.absoluteLifetimeMs,
        idleLifetimeMs: application.policy.idleLifetimeMs,
        sessionVersion: application.sessionVersion,
      }));
    },
    seedStoredApplication: async (application) => {
      const { absoluteLifetimeMs, idleLifetimeMs, ...fields } = application;
      await applications.create({
        ...fields,
        policy: { absoluteLifetimeMs, idleLifetimeMs },
      });
    },
    grant: async (userId, clientId) => {
      const stored = await grants
        .findOne({ userId: new Types.ObjectId(userId), clientId })
        .lean()
        .exec();
      return stored
        ? {
            id: stored._id.toString(),
            allowed: stored.allowed,
            sessionVersion: stored.sessionVersion,
          }
        : null;
    },
    absentGrantId: () => new Types.ObjectId().toString(),
    foreignGrantId: () => A_UUID,
  };
}
