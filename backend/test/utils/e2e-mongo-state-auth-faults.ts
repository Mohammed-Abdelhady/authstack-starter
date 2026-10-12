import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { ClientSession, MongoNetworkError, MongoServerError } from 'mongodb';
import type { Model } from 'mongoose';
import type { PendingPasswordReset } from '../../src/auth/persistence/mongo/schemas/pending-password-reset.schema';
import type { PendingRegistration } from '../../src/auth/persistence/mongo/schemas/pending-registration.schema';
import { MONGO_TRANSIENT_TRANSACTION_LABEL } from '../../src/common/constants/mongo-errors';
import { partialMock } from '../../src/common/testing/test-doubles.harness-spec';
import {
  Role,
  RoleDocument,
} from '../../src/role/persistence/mongo/schemas/role.schema';
import {
  User,
  UserDocument,
} from '../../src/user/persistence/mongo/schemas/user.schema';
import type { E2eAuthFaults, E2eUnknownCommit } from './e2e-state-auth';
import { pauseQuery } from './race-gate';
import { failNextVersionWrite } from './transaction-failure';

/** The driver's own commit, read before any case replaces it. */
const realCommitTransaction = (
  ClientSession.prototype as {
    commitTransaction: (this: ClientSession) => Promise<void>;
  }
).commitTransaction;

function silentCommitFailure(commit: E2eUnknownCommit): Error {
  return commit.bareNetworkError
    ? new MongoNetworkError('connection closed after commit')
    : Object.assign(new Error('unknown commit'), {
        errorLabels: ['UnknownTransactionCommitResult'],
      });
}

/** Holds and faults on MongoDB, at the model and driver calls the cases spied. */
export function mongoAuthFaults(app: INestApplication): E2eAuthFaults {
  const users = app.get<Model<UserDocument>>(getModelToken(User.name));
  const roles = app.get<Model<RoleDocument>>(getModelToken(Role.name));
  const registrations = app.get<Model<PendingRegistration>>(
    getModelToken('PendingRegistration'),
  );
  const resets = app.get<Model<PendingPasswordReset>>(
    getModelToken('PendingPasswordReset'),
  );

  return {
    holdPendingRegistrationInserts: (first, later) => {
      const originalCreate = registrations.create.bind(registrations);
      let call = 0;
      const spy = jest
        .spyOn(registrations, 'create')
        .mockImplementation((...args) => {
          const gate = call === 0 ? first : later;
          call += 1;
          return gate.hold().then(() => originalCreate(...args));
        });
      return () => spy.mockRestore();
    },
    holdPendingRegistrationConsumes: (gate, count) => {
      const original = registrations.findOneAndDelete.bind(registrations);
      let call = 0;
      const spy = jest
        .spyOn(registrations, 'findOneAndDelete')
        .mockImplementation((...args) => {
          const query = original(...args);
          if (call < count) {
            pauseQuery(query, gate);
          }
          call += 1;
          return query;
        });
      return () => spy.mockRestore();
    },
    holdPendingPasswordResetInserts: (first, later) => {
      const originalCreate = resets.create.bind(resets);
      let call = 0;
      const spy = jest.spyOn(resets, 'create').mockImplementation((...args) => {
        const gate = call === 0 ? first : later;
        call += 1;
        return gate.hold().then(() => originalCreate(...args));
      });
      return () => spy.mockRestore();
    },
    failNextAccountWrite: () => {
      const spy = jest
        .spyOn(users.prototype, 'save')
        .mockRejectedValueOnce(new Error('account write failed'));
      return () => spy.mockRestore();
    },
    failNextRoleRead: () => {
      const spy = jest.spyOn(roles, 'findOne').mockReturnValueOnce(
        partialMock<ReturnType<typeof roles.findOne>>({
          exec: jest.fn().mockRejectedValue(new Error('role read failed')),
        }),
      );
      return () => spy.mockRestore();
    },
    makeCommitOutcomesUnknown: (commit) => {
      const spy = commit.lands
        ? jest
            .spyOn(ClientSession.prototype, 'commitTransaction')
            .mockImplementation(async function (this: ClientSession) {
              await realCommitTransaction.call(this).catch(() => undefined);
              throw silentCommitFailure(commit);
            })
        : jest
            .spyOn(ClientSession.prototype, 'commitTransaction')
            .mockImplementation(() =>
              Promise.reject(silentCommitFailure(commit)),
            );
      return () => spy.mockRestore();
    },
    abandonCommitsThenGoSilent: (gate) => {
      const spy = jest
        .spyOn(ClientSession.prototype, 'commitTransaction')
        .mockImplementation(async function (this: ClientSession) {
          // Aborting frees the write locks, so the case can store a row for
          // the same address before this commit reports its unknown result.
          await this.abortTransaction().catch(() => undefined);
          await gate.hold();
          throw silentCommitFailure({ lands: false });
        });
      return () => spy.mockRestore();
    },
    watchAccountLookupsAfterCommit: () => jest.spyOn(users, 'findById'),
    failNextAccountLookupAfterCommit: () => {
      const spy = jest.spyOn(users, 'findById').mockImplementationOnce(() => {
        throw new TypeError('read failed');
      });
      return () => spy.mockRestore();
    },
    abortNextSessionEndingWrite: (gate) => {
      const conflict = new MongoServerError({ message: 'write conflict' });
      conflict.addErrorLabel(MONGO_TRANSIENT_TRANSACTION_LABEL);
      return failNextVersionWrite(users, conflict, gate);
    },
  };
}
