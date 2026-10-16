import { createConnection } from 'mongoose';
import {
  User,
  UserSchema,
} from '../../../src/user/persistence/mongo/schemas/user.schema';
import {
  Role,
  RoleSchema,
} from '../../../src/role/persistence/mongo/schemas/role.schema';
import { toStoredAccount } from '../../../src/user/persistence/mongo/mongo-account-records';
import { toStoredRole } from '../../../src/role/persistence/mongo/mongo-role-mappers';
import { startMemoryReplSet } from '../memory-replset';
import { RecordVersionHarness } from './record-version-harness';

export async function bootMongoRecordVersionHarness(): Promise<RecordVersionHarness> {
  const mongo = await startMemoryReplSet();
  const connection = createConnection(mongo.uri('record_version_contract'));
  const close = async (): Promise<void> => {
    try {
      await connection.close();
    } finally {
      await mongo.stop();
    }
  };
  try {
    await connection.asPromise();
    const users = connection.model(User.name, UserSchema);
    const roles = connection.model(Role.name, RoleSchema);
    await Promise.all([users.init(), roles.init()]);
    const accountVersion = async (id: string): Promise<number | undefined> => {
      const user = await users.findById(id).exec();
      return user ? toStoredAccount(user).version : undefined;
    };
    const roleVersion = async (id: string): Promise<number | undefined> => {
      const role = await roles.findById(id).exec();
      return role ? toStoredRole(role).version : undefined;
    };
    return {
      seed: async () => {
        const user = await users.create({
          email: 'version@example.test',
          name: 'Before',
        });
        const role = await roles.create({ name: 'Version', slug: 'version' });
        return { accountId: user._id.toString(), roleId: role._id.toString() };
      },
      accountVersion,
      roleVersion,
      editAccount: async (id) => {
        await users
          .updateOne(
            { _id: id },
            { $set: { name: 'After', permissions: ['users:read:all'] } },
          )
          .exec();
      },
      editBookkeeping: async (id) => {
        await users
          .updateOne(
            { _id: id },
            { $inc: { sessionVersion: 1, issuanceFence: 1 } },
          )
          .exec();
      },
      editRole: async (id) => {
        await roles
          .updateOne({ _id: id }, { $set: { permissions: ['users:read:all'] } })
          .exec();
      },
      mongoWrites: async (accountId, roleId) => {
        await users
          .updateMany(
            { _id: accountId },
            {
              $set: { 'permissions.0': 'users:read:all' },
              $inc: { sessionVersion: 1 },
            },
          )
          .exec();
        expect(await accountVersion(accountId)).toBe(1);
        const counted = await users.findById(accountId).exec();
        expect(counted?.sessionVersion).toBe(1);
        await users
          .findOneAndUpdate({ _id: accountId }, { name: 'Top level' })
          .exec();
        expect(await accountVersion(accountId)).toBe(2);
        await users
          .updateOne({ _id: accountId }, [
            { $set: { name: 'Pipeline', locale: 'ar' } },
          ])
          .exec();
        expect(await accountVersion(accountId)).toBe(3);
        await users
          .updateOne({ _id: accountId }, [{ $set: { sessionVersion: 2 } }])
          .exec();
        expect(await accountVersion(accountId)).toBe(3);
        const user = await users.findById(accountId).orFail().exec();
        user.name = 'Saved';
        await user.save();
        expect(await accountVersion(accountId)).toBe(4);
        user.sessionVersion += 1;
        await user.save();
        expect(await accountVersion(accountId)).toBe(4);
        await roles
          .updateMany(
            { _id: roleId },
            { $addToSet: { permissions: 'users:read:all' } },
          )
          .exec();
        expect(await roleVersion(roleId)).toBe(1);
        await roles
          .findOneAndUpdate(
            { _id: roleId },
            { $set: { 'permissions.0': 'users:read:staff' } },
          )
          .exec();
        expect(await roleVersion(roleId)).toBe(2);
        await roles
          .updateOne({ _id: roleId }, [{ $set: { name: 'Pipeline role' } }])
          .exec();
        expect(await roleVersion(roleId)).toBe(3);
        const role = await roles.findById(roleId).orFail().exec();
        role.description = 'Saved';
        await role.save();
        expect(await roleVersion(roleId)).toBe(4);
        const older = await users.findById(accountId).orFail().exec();
        const newer = await users.findById(accountId).orFail().exec();
        older.name = 'First document';
        await older.save();
        newer.name = 'Second document';
        await newer.save();
        expect(await accountVersion(accountId)).toBe(6);
      },
      reset: async () => {
        await users.deleteMany({}).exec();
        await roles.deleteMany({}).exec();
      },
      close,
    };
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}
