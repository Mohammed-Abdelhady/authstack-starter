import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  Application,
  ApplicationDocument,
} from '../../src/session/persistence/mongo/schemas/application.schema';
import {
  Session,
  SessionDocument,
} from '../../src/session/persistence/mongo/schemas/session.schema';
import {
  User,
  UserDocument,
} from '../../src/user/persistence/mongo/schemas/user.schema';
import type {
  E2eAccountsState,
  E2eApplicationsState,
  E2eSessionsState,
  E2eStoredAccount,
  E2eStoredApplication,
} from './e2e-state-shared';

function storedAccount(user: UserDocument | null): E2eStoredAccount | null {
  if (!user) return null;
  return {
    _id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: [...user.permissions],
    isVerified: user.isVerified,
    isDeleted: user.isDeleted,
    pendingEmail: user.pendingEmail,
    deletedAt: user.deletedAt,
    addressGeneration: user.addressGeneration,
    password: user.password,
  };
}

function storedApplication(
  stored: Application | null,
): E2eStoredApplication | null {
  if (!stored) return null;
  return {
    clientId: stored.clientId,
    displayName: stored.displayName,
    platform: stored.platform,
    clientType: stored.clientType,
    enabled: stored.enabled,
    redirectUris: stored.redirectUris,
    allowedOrigins: stored.allowedOrigins,
  };
}

/** Accounts on MongoDB, through the user model the cases used to ask for. */
export function mongoAccountsState(app: INestApplication): E2eAccountsState {
  const users = app.get<Model<UserDocument>>(getModelToken(User.name));
  return {
    seedAccounts: async (accounts) => {
      await users.create(accounts);
    },
    createAccount: async (account) => {
      const created = await users.create(account);
      return { _id: created._id.toString() };
    },
    accountIdFor: async (email) => {
      const user = await users.findOne({ email }).exec();
      return user ? user._id.toString() : null;
    },
    accountWithAddress: async (email) =>
      storedAccount(await users.findOne({ email }).select('+password')),
    accountWithId: async (id) => storedAccount(await users.findById(id)),
  };
}

export function mongoSessionsState(app: INestApplication): E2eSessionsState {
  const sessions = app.get<Model<SessionDocument>>(getModelToken(Session.name));
  return {
    sessionIdWithPurpose: async (purpose) => {
      const session = await sessions
        .findOne({ credentialPurpose: purpose })
        .exec();
      return session ? session._id.toString() : null;
    },
    countSessions: () => sessions.countDocuments({}),
    session: async (id) => {
      const session = await sessions.findById(id).lean().exec();
      if (!session) return null;
      return {
        isValid: session.isValid,
        ...(session.proofKeyThumbprint === undefined
          ? {}
          : { proofKeyThumbprint: session.proofKeyThumbprint }),
      };
    },
  };
}

export function mongoApplicationsState(
  app: INestApplication,
): E2eApplicationsState {
  const applications = app.get<Model<ApplicationDocument>>(
    getModelToken(Application.name),
  );
  return {
    createApplication: async (application) => {
      await applications.create(application);
    },
    registerBrowserApplication: async (application) => {
      await applications.create(application);
    },
    application: async (clientId, environment) =>
      storedApplication(
        await applications
          .findOne(
            environment === undefined
              ? { clientId }
              : { clientId, environment },
          )
          .lean()
          .exec(),
      ),
    applicationCount: (clientId) =>
      applications.countDocuments({ clientId }).exec(),
    applicationCountIn: (environment) =>
      applications.countDocuments({ environment }).exec(),
    removeApplicationsIn: async (environment) => {
      await applications.deleteMany({ environment }).exec();
    },
    changeApplication: async (clientId, change) => {
      await applications.updateOne({ clientId }, { $set: change }).exec();
    },
    storeApplicationRedirects: async (clientId, redirectUris) => {
      await applications.collection.updateOne(
        { clientId },
        { $set: { redirectUris } },
      );
    },
  };
}
