import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { PendingRegistration } from '../../src/auth/persistence/mongo/schemas/pending-registration.schema';

const LEGACY_ADDRESS_RULE = 'email_1';

/** A pending record from before records carried a purpose. */
export interface MongoLegacyPendingRegistration {
  email: string;
  name: string;
  hashedCode: string;
  hashedPassword?: string;
  attempts: number;
  expiresAt: Date;
}

export interface MongoLegacyPendingRegistrations {
  /** Stores a record from before purposes existed. */
  storeLegacyPendingRegistration(
    record: MongoLegacyPendingRegistration,
  ): Promise<void>;
  /**
   * Puts back the rule of one record an address, from before purposes existed.
   * The answer removes it again.
   */
  restoreLegacyAddressRule(): Promise<() => Promise<void>>;
  /** The purpose of every record stored for the address. */
  pendingRegistrationsFor(email: string): Promise<{ purpose: string }[]>;
}

/** Records from before a pending registration carried a purpose. */
export function mongoLegacyPendingRegistrations(
  app: INestApplication,
): MongoLegacyPendingRegistrations {
  const registrations = app.get<Model<PendingRegistration>>(
    getModelToken('PendingRegistration'),
  );
  return {
    storeLegacyPendingRegistration: async (record) => {
      await registrations.collection.insertOne({ ...record });
    },
    restoreLegacyAddressRule: async () => {
      const collection = registrations.collection;
      await collection.createIndex(
        { email: 1 },
        { unique: true, name: LEGACY_ADDRESS_RULE },
      );
      return async () => {
        await collection.dropIndex(LEGACY_ADDRESS_RULE).catch(() => undefined);
      };
    },
    pendingRegistrationsFor: async (email) => {
      const records = await registrations.find({ email }).select('+hashedCode');
      return records.map((record) => ({ purpose: record.purpose }));
    },
  };
}
