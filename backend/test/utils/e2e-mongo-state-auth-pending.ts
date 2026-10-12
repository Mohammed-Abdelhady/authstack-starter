import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { PendingMagicLinkDocument } from '../../src/auth/magic-link/persistence/mongo/schemas/pending-magic-link.schema'; // feature:magic-link
import type { MailCounter } from '../../src/auth/persistence/mongo/schemas/mail-counter.schema';
import type { PendingPasswordReset } from '../../src/auth/persistence/mongo/schemas/pending-password-reset.schema';
import type { PendingRegistration } from '../../src/auth/persistence/mongo/schemas/pending-registration.schema';
import type {
  E2ePendingCodeState,
  E2ePendingRegistration,
} from './e2e-state-auth';
import { seedMailCounter } from './mail-counter-seed';

function pendingRegistration(
  record: PendingRegistration,
): E2ePendingRegistration {
  return {
    purpose: record.purpose,
    hashedCode: record.hashedCode,
    attempts: record.attempts,
    addressGeneration: record.addressGeneration,
  };
}

/** Mailed codes on MongoDB, through the models the cases used to ask for. */
export function mongoPendingCodeState(
  app: INestApplication,
): E2ePendingCodeState {
  const registrations = app.get<Model<PendingRegistration>>(
    getModelToken('PendingRegistration'),
  );
  const resets = app.get<Model<PendingPasswordReset>>(
    getModelToken('PendingPasswordReset'),
  );
  const mailCounters = app.get<Model<MailCounter>>(
    getModelToken('MailCounter'),
  );

  return {
    storePendingRegistration: async ({ userId, ...record }) => {
      await registrations.create(
        userId === undefined
          ? record
          : { ...record, userId: new Types.ObjectId(userId) },
      );
    },
    pendingRegistrationFor: async (email) => {
      const record = await registrations
        .findOne({ email })
        .select('+hashedCode');
      return record ? pendingRegistration(record) : null;
    },
    storedPendingRegistrationFields: (email) =>
      registrations.collection.findOne({ email }),
    countPendingRegistrations: (email, purpose) =>
      registrations.countDocuments(
        purpose === undefined ? { email } : { email, purpose },
      ),
    removePendingRegistration: async (email) => {
      await registrations.deleteOne({ email });
    },
    removeEveryPendingRegistration: async (email) => {
      await registrations.deleteMany({ email });
    },
    replacePendingRegistrationCode: async (email, code) => {
      await registrations.updateOne({ email }, { $set: code });
    },

    storePendingPasswordReset: async (record) => {
      await resets.create(record);
    },
    pendingPasswordResetFor: async (email) => {
      const record = await resets.findOne({ email }).select('+hashedCode');
      return record
        ? { hashedCode: record.hashedCode, attempts: record.attempts }
        : null;
    },
    countPendingPasswordResets: (email) => resets.countDocuments({ email }),
    removePendingPasswordReset: async (email) => {
      await resets.deleteOne({ email });
    },
    replacePendingPasswordResetCode: async (email, code) => {
      await resets.updateOne({ email }, { $set: code });
    },

    storeMailCounter: (seed) => seedMailCounter(mailCounters, seed),
    mailCounterFor: async (email, purpose) => {
      const counter = await mailCounters.findOne({ email, purpose });
      return counter ? { mailedCodes: counter.mailedCodes } : null;
    },
    // feature:magic-link:start
    storeMagicLinks: async (links) => {
      await app
        .get<Model<PendingMagicLinkDocument>>(getModelToken('PendingMagicLink'))
        .create(links, { timestamps: false });
    },
    expireMagicLinks: async () => {
      await app
        .get<Model<PendingMagicLinkDocument>>(getModelToken('PendingMagicLink'))
        .updateMany({}, { expiresAt: new Date(0) });
    },
    // feature:magic-link:end
  };
}
