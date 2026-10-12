import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ApplicationAccessStore } from '../../../../src/session/applications/application-access.store';
import { ApplicationRegistryStore } from '../../../../src/session/applications/application-registry.store';
import { AuthorityApplications } from '../../../../src/session/authority/authority-applications';
import { SessionAuthorityStore } from '../../../../src/session/authority/session-authority.store';
import { NativeAccessStore } from '../../../../src/session/native/credentials/native-access.store';
import { NativeCredentialStore } from '../../../../src/session/native/credentials/native-credential.store';
import { NativeSecurityEvents } from '../../../../src/session/native/credentials/native-security-events';
import { MongoNativeAuthorizationStore } from '../../../../src/session/native/persistence/mongo/mongo-native-authorization.store';
import { MongoNativeRotationStore } from '../../../../src/session/native/persistence/mongo/mongo-native-rotation.store';
import { SessionRevocationStore } from '../../../../src/session/revocation/session-revocation.store';
import {
  AuthorizationTransaction,
  AuthorizationTransactionDocument,
} from '../../../../src/session/persistence/mongo/schemas/authorization-transaction.schema';
import {
  NativeCredential,
  NativeCredentialDocument,
} from '../../../../src/session/persistence/mongo/schemas/native-credential.schema';
import {
  NativeDpopProofId,
  NativeDpopProofIdDocument,
} from '../../../../src/session/persistence/mongo/schemas/native-dpop-proof-id.schema';
import { CONTRACT_ENVIRONMENT } from '../../session/issuance-contract/issuance-contract-harness';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { bootMongoIssuance } from '../../session/issuance-contract/mongo-issuance-harness';
import { REFUSED_EVENT_SEED_ACTION } from '../../transaction-failure';
import {
  NativeContractHarness,
  SEES_COMMITS,
  TAKEN_AT,
} from './native-contract-harness';
import { buildNativeServices } from './native-contract-services';
import {
  NATIVE_APPLICATION,
  NATIVE_CLIENT,
  NATIVE_DISPLAY_NAME,
} from './native-contract-support';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

export async function bootMongoNativeHarness(): Promise<NativeContractHarness> {
  const {
    harness: issuance,
    booted,
    events,
  } = await bootMongoIssuance('native_contract');
  const { app, users, sessions, grants, applications } = booted;
  const transactions = app.get<Model<AuthorizationTransactionDocument>>(
    getModelToken(AuthorizationTransaction.name),
  );
  const credentials = app.get<Model<NativeCredentialDocument>>(
    getModelToken(NativeCredential.name),
  );
  const proofIds = app.get<Model<NativeDpopProofIdDocument>>(
    getModelToken(NativeDpopProofId.name),
  );
  const stores = {
    authorizations: new MongoNativeAuthorizationStore(transactions),
    registry: app.get(ApplicationRegistryStore),
    grants: app.get(ApplicationAccessStore),
    credentials: app.get(NativeCredentialStore),
    rotations: new MongoNativeRotationStore(credentials, sessions),
    access: app.get(NativeAccessStore),
    events: app.get(NativeSecurityEvents),
  };

  return {
    issuance,
    takenAt: TAKEN_AT.FIRST_WRITE,
    seesCommits: SEES_COMMITS.UNTIL_ITS_START,
    stores,
    services: (options = {}) =>
      buildNativeServices(
        {
          runner: issuance.runner(options.pause ?? rerunAtOnce),
          clock: issuance.clock,
          stores,
          issuanceStore: issuance.store,
          issuanceApplications: issuance.applications,
          revocationStore: app.get(SessionRevocationStore),
          authorityStore: app.get(SessionAuthorityStore),
          authorityApplications: app.get(AuthorityApplications),
        },
        options,
      ),

    seedNativeApplication: async (patch = {}) => {
      const seed = { ...NATIVE_APPLICATION, ...patch };
      await applications.updateOne(
        { clientId: NATIVE_CLIENT, environment: CONTRACT_ENVIRONMENT },
        {
          $set: {
            displayName: NATIVE_DISPLAY_NAME,
            platform: seed.platform,
            clientType: seed.clientType,
            enabled: seed.enabled,
            redirectUris: seed.redirectUris,
            sessionVersion: seed.sessionVersion,
            allowedScopes: ['api'],
            policy: {
              absoluteLifetimeMs: NATIVE_APPLICATION.absoluteLifetimeMs,
              idleLifetimeMs: NATIVE_APPLICATION.idleLifetimeMs,
            },
          },
        },
        { upsert: true },
      );
    },
    authorization: async (transactionId) => {
      const stored = await transactions.findOne({ transactionId }).lean();
      return stored
        ? {
            id: stored._id.toString(),
            consumed: stored.consumed,
            codeHash: stored.codeHash ?? null,
            expiresAt: stored.expiresAt,
            codeExpiresAt: stored.codeExpiresAt ?? null,
            userId: stored.userId ? stored.userId.toString() : null,
            state: stored.state,
            requestedScopes: stored.requestedScopes,
            authEpoch: stored.authEpoch,
            authenticationMethods: stored.authenticationMethods,
            capturedUserVersion: stored.capturedUserVersion ?? null,
            capturedClientVersion: stored.capturedClientVersion ?? null,
            capturedGrantVersion: stored.capturedGrantVersion ?? null,
          }
        : null;
    },
    credentialsOf: async (sessionId) => {
      const stored = await credentials
        .find({ sessionId: new Types.ObjectId(sessionId) })
        .sort({ generation: 1, purpose: 1, _id: 1 })
        .lean();
      return stored.map((row) => ({
        id: row._id.toString(),
        tokenHash: row.tokenHash,
        purpose: row.purpose,
        generation: row.generation,
        familyId: row.familyId,
        expiresAt: row.expiresAt,
        spent: row.spent,
        consumedAt: row.consumedAt ?? null,
        revokedAt: row.revokedAt ?? null,
        firstUsedAt: row.firstUsedAt ?? null,
        proofKeyThumbprint: row.proofKeyThumbprint ?? null,
        successorAccessHash: row.successorAccessHash ?? null,
        successorRefreshHash: row.successorRefreshHash ?? null,
        retryClaimUntil: row.retryClaimUntil ?? null,
      }));
    },
    patchCredential: async (tokenHash, patch) => {
      await credentials.updateOne({ tokenHash }, { $set: patch });
    },
    session: async (sessionId) => {
      const stored = await sessions.findById(sessionId).lean();
      return stored
        ? {
            isValid: stored.isValid,
            revokedAt: stored.revokedAt ?? null,
            revokedReason: stored.revokedReason ?? null,
            credentialPurpose: stored.credentialPurpose,
            proofKeyThumbprint: stored.proofKeyThumbprint ?? null,
            userVersion: stored.userVersion,
            clientVersion: stored.clientVersion,
            grantVersion: stored.grantVersion,
            scopes: stored.scopes,
            authenticationMethods: stored.authenticationMethods,
            expiresAt: stored.expiresAt,
            idleExpiresAt: stored.idleExpiresAt,
          }
        : null;
    },
    revokeSession: async (sessionId) => {
      await sessions.updateOne(
        { _id: new Types.ObjectId(sessionId) },
        { $set: { isValid: false, revokedAt: issuance.clock.now() } },
      );
    },
    patchGrant: async (userId, patch) => {
      await grants.updateOne(
        { userId: new Types.ObjectId(userId), clientId: NATIVE_CLIENT },
        { $set: patch },
      );
    },
    removeGrant: async (userId) => {
      await grants.deleteOne({
        userId: new Types.ObjectId(userId),
        clientId: NATIVE_CLIENT,
      });
    },
    markAccountDeleted: async (userId) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $set: { isDeleted: true } },
      );
    },
    storedProofIds: () => proofIds.countDocuments({}),
    events: async () => {
      const stored = await events
        .find({ action: { $ne: REFUSED_EVENT_SEED_ACTION } })
        .sort({ _id: 1 })
        .lean();
      return stored.map((event) => ({
        action: event.action,
        targetUserId: event.targetUserId ?? null,
        clientId: event.clientId ?? null,
        sessionId: event.sessionId ?? null,
        reasonCode: event.reasonCode ?? null,
        outcome: event.outcome,
      }));
    },
    absentId: () => new Types.ObjectId().toString(),
    foreignId: () => A_UUID,
    reset: async () => {
      await transactions.deleteMany({});
      await credentials.deleteMany({});
      await proofIds.deleteMany({});
      await issuance.reset();
    },
  };
}
