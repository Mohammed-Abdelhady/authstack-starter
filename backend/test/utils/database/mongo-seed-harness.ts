import { MongoSeedStore } from '../../../src/database/seeds/persistence/mongo/mongo-seed.store';
import {
  Role,
  RoleDocument,
  RoleSchema,
} from '../../../src/role/persistence/mongo/schemas/role.schema';
import { ApplicationRegistry } from '../../../src/session/applications/application-registry';
import { FrozenClock, TEST_NOW } from '../frozen-clock';
import { startMemoryReplSet } from '../memory-replset';
import { bootSessionAuthority } from '../session-authority-harness';
import { SeedContractHarness } from './seed-contract-harness';

/** The collection `migrate-mongo-config.js` names for applied migrations. */
const CHANGELOG = 'migrations';

export async function bootMongoSeedHarness(): Promise<SeedContractHarness> {
  const mongo = await startMemoryReplSet();
  const clock = new FrozenClock(TEST_NOW);
  const booted = await bootSessionAuthority(mongo.uri('seed_contract'), clock);
  const { app, users, applications, connection } = booted;
  connection.model(Role.name, RoleSchema);
  const roles = connection.model<RoleDocument>(Role.name);
  await roles.init();
  const changelog = connection.collection(CHANGELOG);

  return {
    clock,
    seeds: new MongoSeedStore(users, roles),
    registry: app.get(ApplicationRegistry),

    storedApplications: async () => {
      const stored = await applications
        .find({})
        .sort({ clientId: 1 })
        .lean()
        .exec();
      return stored.map(({ clientId, platform, enabled }) => ({
        clientId,
        platform,
        enabled,
      }));
    },
    storedRoles: async () => {
      const stored = await roles.find({}).sort({ slug: 1 }).lean().exec();
      return stored.map((role) => ({
        name: role.name,
        slug: role.slug,
        description: role.description ?? null,
        isSystemRole: role.isSystemRole,
        isProtected: role.isProtected,
        level: role.level ?? null,
        permissions: role.permissions,
      }));
    },
    storedAccounts: async () => {
      const stored = await users
        .find({})
        .select('+password')
        .sort({ email: 1 })
        .lean()
        .exec();
      return stored.map((user) => ({
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: user.permissions,
        passwordHash: user.password ?? null,
        isVerified: user.isVerified,
        isDeleted: user.isDeleted,
        authProvider: user.authProvider ?? null,
      }));
    },
    plantRole: async (role) => {
      await roles.collection.insertOne({
        name: role.name,
        slug: role.slug,
        ...(role.description === null ? {} : { description: role.description }),
        isSystemRole: role.isSystemRole,
        isProtected: role.isProtected,
        ...(role.level === null ? {} : { level: role.level }),
        permissions: role.permissions,
        pendingHolderSweeps: [],
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });
    },
    plantAccount: async (account) => {
      const created = await users.create({
        email: account.email,
        name: account.name,
        role: account.role,
        password: account.passwordHash,
        isVerified: true,
      });
      return created._id.toString();
    },
    plantMigrationRecord: async (name) => {
      await changelog.insertOne({ fileName: name, appliedAt: clock.now() });
    },
    migrationRecord: async () => {
      const applied = await changelog.find({}).sort({ fileName: 1 }).toArray();
      return applied.map((entry) => String(entry.fileName));
    },
    reset: async () => {
      for (const collection of Object.values(connection.collections)) {
        await collection.deleteMany({});
      }
      await changelog.deleteMany({});
    },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
