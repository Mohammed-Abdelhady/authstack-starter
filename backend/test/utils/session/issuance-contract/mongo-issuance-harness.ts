import { EventRecorder } from '../../../../src/auth/contracts/event-recorder';
import { EnrolmentStore } from '../../../../src/session/enrolment/enrolment.store';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthEpochService } from '../../../../src/common/services/auth-epoch.service';
import { RerunPause } from '../../../../src/common/persistence/unit-of-work';
import { BrowserIssuanceStore } from '../../../../src/session/issuance/browser-issuance.store';
import { IssuanceApplications } from '../../../../src/session/issuance/issuance-applications';
import { MongoUnitOfWorkRunner } from '../../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../src/session/persistence/mongo/schemas/security-event.schema';
import { SessionIssuanceService } from '../../../../src/session/services/session-issuance.service';
import { FrozenClock, TEST_NOW } from '../../frozen-clock';
import { startMemoryReplSet } from '../../memory-replset';
import {
  bootSessionAuthority,
  SessionAuthorityHarness,
} from '../../session-authority-harness';
import {
  loseCommitAnswers,
  REFUSED_EVENT_SEED_ACTION,
  refuseSecurityEvents,
} from '../../transaction-failure';
import {
  CONTRACT_ENVIRONMENT,
  IssuanceContractHarness,
} from './issuance-contract-harness';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';
const CLIENT_TYPES: Readonly<Record<string, string>> = {
  admin: 'confidential',
};

export interface MongoIssuanceBoot {
  harness: IssuanceContractHarness;
  /** The booted application, for a contract that needs more of it. */
  booted: SessionAuthorityHarness;
  events: Model<SecurityEventDocument>;
}

export async function bootMongoIssuanceHarness(): Promise<IssuanceContractHarness> {
  return (await bootMongoIssuance('issuance_contract')).harness;
}

export async function bootMongoIssuance(
  databaseName: string,
): Promise<MongoIssuanceBoot> {
  const mongo = await startMemoryReplSet();
  const clock = new FrozenClock(TEST_NOW);
  const booted = await bootSessionAuthority(mongo.uri(databaseName), clock);
  const { app, users, sessions, grants, applications, connection } = booted;
  const events = app.get<Model<SecurityEventDocument>>(
    getModelToken(SecurityEvent.name),
  );
  const store = app.get(BrowserIssuanceStore);
  const issuanceApplications = app.get(IssuanceApplications);
  const authEpoch = app.get(AuthEpochService);
  const runner = (pause: RerunPause) =>
    new MongoUnitOfWorkRunner(connection, pause);
  let accounts = 0;

  const harness: IssuanceContractHarness = {
    clock,
    store,
    applications: issuanceApplications,
    runner,
    service: (pause) =>
      new SessionIssuanceService(
        runner(pause),
        store,
        issuanceApplications,
        clock,
        authEpoch,
        app.get(EventRecorder),
        app.get(EnrolmentStore),
      ),

    seedAccount: async (options) => {
      accounts += 1;
      const user = await users.create({
        email: `contract-${accounts}@example.test`,
        name: 'Contract Tester',
        role: 'user',
        isVerified: true,
        sessionVersion: 0,
        isDeleted: options?.deleted ?? false,
        audience: options?.audience,
      });
      return user._id.toString();
    },
    seedApplication: async (application) => {
      await applications.updateOne(
        { clientId: application.clientId, environment: CONTRACT_ENVIRONMENT },
        {
          $set: {
            displayName: application.clientId,
            platform: application.platform,
            clientType: CLIENT_TYPES[application.clientId] ?? 'public',
            enabled: application.enabled,
            sessionVersion: application.sessionVersion,
            policyVersion: application.policyVersion ?? 0,
            requirePasskey: application.requirePasskey ?? false,
            sessionCap: application.sessionCap ?? null,
            accountAudience: application.accountAudience ?? null,
            allowedScopes: ['api'],
            policy: {
              absoluteLifetimeMs: application.absoluteLifetimeMs,
              idleLifetimeMs: application.idleLifetimeMs,
              unboundAbsoluteLifetimeMs: application.unboundAbsoluteLifetimeMs,
              unboundIdleLifetimeMs: application.unboundIdleLifetimeMs,
            },
          },
        },
        { upsert: true },
      );
    },
    seedBlockedGrant: async (userId, clientId) => {
      await grants.create({
        userId: new Types.ObjectId(userId),
        clientId,
        allowed: false,
        sessionVersion: 1,
        issuanceFence: 0,
      });
    },
    setSessionProofKey: async (sessionId, thumbprint) => {
      await sessions.updateOne(
        { _id: new Types.ObjectId(sessionId) },
        { $set: { proofKeyThumbprint: thumbprint } },
      );
    },
    revokeOneSession: async (userId) => {
      await sessions.updateOne(
        { user: new Types.ObjectId(userId) },
        { $set: { isValid: false, revokedAt: clock.now() } },
      );
    },
    bumpAccountVersion: async (userId) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        { $inc: { sessionVersion: 1 } },
      );
    },

    account: async (userId) => {
      const user = await users.findById(userId).lean().exec();
      return user
        ? {
            issuanceFence: user.issuanceFence,
            sessionVersion: user.sessionVersion,
          }
        : null;
    },
    sessions: async (userId) => {
      const stored = Types.ObjectId.isValid(userId)
        ? await sessions.find({ user: userId }).lean().exec()
        : [];
      return stored.map((session) => ({
        id: session._id.toString(),
        tokenHash: session.tokenHash,
        tokenHashBytes: Buffer.from(session.tokenHash, 'hex').length,
        csrfToken: session.csrfToken ?? null,
        clientId: session.clientId,
        isValid: session.isValid,
        revoked: session.revokedAt instanceof Date,
        userVersion: session.userVersion,
        clientVersion: session.clientVersion,
        grantVersion: session.grantVersion,
        authenticationMethods: session.authenticationMethods,
        userVerified: session.userVerified,
        policyVersion: session.policyVersion,
        deviceName: session.deviceName ?? null,
        device: session.device ?? null,
        authenticatedAt: session.authenticatedAt,
        expiresAt: session.expiresAt,
        idleExpiresAt: session.idleExpiresAt,
      }));
    },
    grants: async (userId) => {
      const stored = Types.ObjectId.isValid(userId)
        ? await grants.find({ userId }).lean().exec()
        : [];
      return stored.map((grant) => ({
        id: grant._id.toString(),
        clientId: grant.clientId,
        allowed: grant.allowed,
        issuanceFence: grant.issuanceFence,
      }));
    },
    events: async () => {
      const stored = await events
        .find({ action: { $ne: REFUSED_EVENT_SEED_ACTION } })
        .lean()
        .exec();
      return stored.map((event) => ({
        action: event.action,
        outcome: event.outcome,
        targetUserId: event.targetUserId ?? null,
        clientId: event.clientId ?? null,
        sessionId: event.sessionId ?? null,
      }));
    },

    absentAccountId: () => new Types.ObjectId().toString(),
    foreignAccountId: () => A_UUID,

    refuseSecurityEvents: () => refuseSecurityEvents(events, TEST_NOW),
    loseCommitAnswers: ({ lands, times }) =>
      loseCommitAnswers(connection, {
        lands,
        times: times ?? Number.MAX_SAFE_INTEGER,
      }),

    reset: async () => {
      await sessions.deleteMany({});
      await grants.deleteMany({});
      await users.deleteMany({});
      await events.deleteMany({});
      await applications.deleteMany({});
    },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
  return { harness, booted, events };
}
