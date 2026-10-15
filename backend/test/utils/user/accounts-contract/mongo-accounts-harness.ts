import { SessionIssuanceService } from '../../../../src/session/services/session-issuance.service';
import { mongoAccountsApplications } from './mongo-accounts-applications';
import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PENDING_PURPOSE } from '../../../../src/auth/constants/registration';
import { AddressLedger } from '../../../../src/common/persistence/address-ledger';
import {
  AddressClaim,
  AddressClaimDocument,
  AddressClaimSchema,
} from '../../../../src/common/persistence/mongo/schemas/address-claim.schema';
import { MongoAdminAccountStore } from '../../../../src/admin/persistence/mongo/mongo-admin-account.store';
// feature:passkeys:start
import {
  Passkey,
  PasskeyDocument,
  PasskeySchema,
} from '../../../../src/auth/passkeys/persistence/mongo/schemas/passkey.schema';
// feature:passkeys:end
import {
  MongoActivationAccounts,
  activatedDocumentOf,
} from '../../../../src/auth/persistence/mongo/mongo-activation-accounts';
import { MongoIdFormat } from '../../../../src/common/persistence/mongo/mongo-id-format';
import { MongoMailCounterStore } from '../../../../src/auth/persistence/mongo/mongo-mail-counter.store';
import { MongoPasswordSignInStore } from '../../../../src/auth/persistence/mongo/mongo-password-sign-in.store';
import { MongoPendingRegistrationStore } from '../../../../src/auth/persistence/mongo/mongo-pending-registration.store';
import {
  ActivatedAccount,
  ActivationSignIn,
  ActivationSignInOutcome,
} from '../../../../src/auth/pending-codes/activation-accounts';
import {
  MailCounter,
  MailCounterDocument,
  MailCounterSchema,
} from '../../../../src/auth/persistence/mongo/schemas/mail-counter.schema';
import {
  PendingRegistration,
  PendingRegistrationDocument,
  PendingRegistrationSchema,
} from '../../../../src/auth/persistence/mongo/schemas/pending-registration.schema';
import { MongoRolePermissions } from '../../../../src/role/persistence/mongo/mongo-role-permissions';
import { mongoRoleStores } from '../../../../src/role/persistence/mongo/mongo-role-stores';
import {
  Role,
  RoleDocument,
  RoleSchema,
} from '../../../../src/role/persistence/mongo/schemas/role.schema';
import { SessionRevoker } from '../../../../src/session/revocation/session-revoker';
import { MongoUnitOfWorkRunner } from '../../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../src/session/persistence/mongo/schemas/security-event.schema';
import { SecurityEventService } from '../../../../src/session/persistence/mongo/security-event.service';
import { hashToken } from '../../../../src/session/utils/hashing/token-hash';
import { MongoAccountPermissionStore } from '../../../../src/user/persistence/mongo/mongo-account-permission.store';
import { MongoAccountProfileStore } from '../../../../src/user/persistence/mongo/mongo-account-profile.store';
import { RevokerAccountSessions } from '../../../../src/user/stores/revoker-account-sessions';
import { FrozenClock, TEST_NOW } from '../../frozen-clock';
import { MemoryReplSet, startMemoryReplSet } from '../../memory-replset';
import {
  bootSessionAuthority,
  SessionAuthorityHarness,
} from '../../session-authority-harness';
import {
  REFUSED_EVENT_SEED_ACTION,
  refuseSecurityEvents,
} from '../../transaction-failure';
import { AccountsContractHarness } from './accounts-contract-harness';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

/**
 * Answers with the account the activation stored and issues nothing, the way
 * the stand-in on the other database does, so both run the same cases.
 */
class SummarySignIn extends ActivationSignIn {
  recordCreationRefusal(_clientId: string): Promise<void> {
    return Promise.resolve();
  }

  complete(account: ActivatedAccount): Promise<ActivationSignInOutcome> {
    const user = activatedDocumentOf(account);
    return Promise.resolve({
      requiresTwoFactor: false,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        ...(user.audience ? { audience: user.audience } : {}),
        authProvider: user.authProvider,
        isVerified: user.isVerified,
        permissions: [],
      },
    });
  }
}

export interface MongoAccountsHarness extends AccountsContractHarness {
  readonly booted: SessionAuthorityHarness;
  readonly mongo: MemoryReplSet;
}

export async function bootMongoAccountsHarness(): Promise<MongoAccountsHarness> {
  const mongo = await startMemoryReplSet();
  const clock = new FrozenClock(TEST_NOW);
  const booted = await bootSessionAuthority(
    mongo.uri('accounts_contract'),
    clock,
  );
  const { app, users, sessions, connection } = booted;
  const creation = mongoAccountsApplications(booted);
  connection.model(Role.name, RoleSchema);
  connection.model(PendingRegistration.name, PendingRegistrationSchema);
  connection.model(MailCounter.name, MailCounterSchema);
  connection.model(Passkey.name, PasskeySchema); // feature:passkeys
  connection.model(AddressClaim.name, AddressClaimSchema);
  const claims = connection.model<AddressClaimDocument>(AddressClaim.name);
  await claims.init();
  const roles = connection.model<RoleDocument>(Role.name);
  const registrations = connection.model<PendingRegistrationDocument>(
    PendingRegistration.name,
  );
  const counters = connection.model<MailCounterDocument>(MailCounter.name);
  const passkeys = connection.model<PasskeyDocument>(Passkey.name); // feature:passkeys
  await Promise.all([roles.init(), registrations.init(), counters.init()]);
  await passkeys.init(); // feature:passkeys
  const events = app.get<Model<SecurityEventDocument>>(
    getModelToken(SecurityEvent.name),
  );
  const roleStores = mongoRoleStores({
    roleModel: roles,
    userModel: users,
    connection,
    events: app.get(SecurityEventService),
  });
  let agents = 0;

  return {
    booted,
    mongo,
    issuanceApplications: creation.issuanceApplications,
    sessionIssuance: app.get(SessionIssuanceService),
    configureCreationApplication: creation.configureCreationApplication,
    clock,
    ledger: app.get(AddressLedger),
    claims: async () =>
      (await claims.find({}).sort({ _id: 1 }).lean().exec()).map((row) => ({
        address: row._id,
        kind: row.kind,
        owner: row.owner,
        lapsesAt: row.lapsesAt,
      })),
    emailChangeCode: async (email) => {
      const row = await registrations
        .findOne({ email, purpose: PENDING_PURPOSE.EMAIL_CHANGE })
        .select('+hashedCode')
        .lean()
        .exec();
      return row ? { hash: row.hashedCode, expiresAt: row.expiresAt } : null;
    },
    profiles: new MongoAccountProfileStore(
      users,
      roles,
      passkeys, // feature:passkeys
    ),
    permissions: new MongoAccountPermissionStore(users),
    sessions: new RevokerAccountSessions(app.get(SessionRevoker)),
    admin: new MongoAdminAccountStore(users, roles),
    activation: new MongoActivationAccounts(users),
    signIn: new SummarySignIn(),
    roleCatalog: roleStores.catalog,
    roleChanges: roleStores.changes,
    roleSweeps: roleStores.sweeps,
    registrations: new MongoPendingRegistrationStore(registrations, counters),
    mailCounters: new MongoMailCounterStore(counters),
    passwords: new MongoPasswordSignInStore(users),
    rolePermissions: new MongoRolePermissions(roles),
    runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),

    alterRoleAudience: async (slug, audience) => {
      await roles.collection.updateOne({ slug }, { $set: { audience } });
    },
    seedRole: async (role) => {
      const created = await roles.create({
        name: role.name,
        slug: role.slug,
        audience: role.audience,
        level: role.level,
        permissions: role.permissions,
      });
      return created._id.toString();
    },
    seedAccount: async (account) => {
      const user = await users.create({
        email: account.email,
        pendingEmail: account.pendingEmail,
        name: account.name ?? 'Contract Tester',
        role: account.role,
        audience: account.audience,
        permissions: account.permissions ?? [],
        password: account.passwordHash,
        isVerified: account.verified ?? true,
        isDeleted: account.deleted ?? false,
        addressGeneration: account.addressGeneration ?? 0,
        sessionVersion: 0,
        ...(account.createdAt
          ? { createdAt: account.createdAt, updatedAt: account.createdAt }
          : {}),
      });
      return user._id.toString();
    },
    seedSession: async (userId) => {
      agents += 1;
      const issued = await booted.sessionService.createSession(
        new Types.ObjectId(userId),
        `contract/${agents}`,
        '127.0.0.1',
        WEB_CLIENT_ID,
      );
      const stored = await sessions
        .findOne({ tokenHash: hashToken(issued.sessionToken) })
        .orFail()
        .exec();
      return stored._id.toString();
    },
    alterAccount: async (userId, change) => {
      await users.updateOne(
        { _id: new Types.ObjectId(userId) },
        {
          $set: {
            ...(change.role === undefined ? {} : { role: change.role }),
            ...(change.audience === undefined
              ? {}
              : { audience: change.audience }),
            ...(change.deleted === undefined
              ? {}
              : { isDeleted: change.deleted }),
            ...(change.email === undefined ? {} : { email: change.email }),
            ...(change.verified === undefined
              ? {}
              : { isVerified: change.verified }),
            ...(change.permissions === undefined
              ? {}
              : { permissions: change.permissions }),
          },
        },
      );
    },
    removeRole: async (slug) => {
      await roles.deleteOne({ slug });
    },

    account: async (userId) => {
      const user = await users
        .findById(userId)
        .select('+password')
        .lean()
        .exec();
      if (!user) return null;
      return {
        email: user.email,
        pendingEmail: user.pendingEmail ?? null,
        name: user.name,
        role: user.role,
        ...(user.audience ? { audience: user.audience } : {}),
        permissions: user.permissions,
        passwordHash: user.password ?? null,
        isVerified: user.isVerified,
        isDeleted: user.isDeleted,
        deletedAt: user.deletedAt ?? null,
        sessionVersion: user.sessionVersion,
        addressGeneration: user.addressGeneration ?? 0,
        authProvider: user.authProvider ?? null,
        primaryProvider: user.primaryProvider ?? null,
      };
    },
    accountIdByEmail: async (email) => {
      const user = await users.findOne({ email }).lean().exec();
      return user ? user._id.toString() : null;
    },
    liveSessionIds: async (userId) => {
      const user = await users.findById(userId).lean().exec();
      const live = await sessions
        .find({
          user: new Types.ObjectId(userId),
          isValid: true,
          revokedAt: { $exists: false },
          userVersion: user?.sessionVersion ?? 0,
        })
        .lean()
        .exec();
      return live.map((session) => session._id.toString()).sort();
    },
    events: async () => {
      const stored = await events
        .find({ action: { $ne: REFUSED_EVENT_SEED_ACTION } })
        .lean()
        .exec();
      return stored.map((event) => ({
        targetUserId: event.targetUserId ?? null,
        actorId: event.actorId ?? null,
        sessionId: event.sessionId ?? null,
        action: event.action,
        reasonCode: event.reasonCode ?? null,
        assignedRoleId: event.roleAssignment?.assignedRoleId ?? null,
        previousRoleId: event.roleAssignment?.previousRoleId ?? null,
        assignmentSessionVersion: event.roleAssignment?.sessionVersion ?? null,
      }));
    },
    pendingRegistrations: (email) => registrations.countDocuments({ email }),

    ids: new MongoIdFormat(),
    absentId: () => new Types.ObjectId().toString(),
    foreignId: () => A_UUID,

    refuseSecurityEvents: () => refuseSecurityEvents(events, TEST_NOW),

    reset: async () => {
      await Promise.all([
        claims.deleteMany({}),
        users.deleteMany({}),
        roles.deleteMany({}),
        events.deleteMany({}),
        sessions.deleteMany({}),
        booted.grants.deleteMany({}),
        booted.applications.deleteMany({}),
        registrations.deleteMany({}),
        counters.deleteMany({}),
      ]);
      await creation.seedCreationApplications();
    },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
