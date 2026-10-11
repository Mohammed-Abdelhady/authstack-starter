import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { mongoRoleStores } from '../../../../src/role/persistence/mongo/mongo-role-stores';
import {
  Role,
  RoleDocument,
  RoleSchema,
} from '../../../../src/role/persistence/mongo/schemas/role.schema';
import { MongoUnitOfWorkRunner } from '../../../../src/session/persistence/mongo/mongo-unit-of-work';
import {
  SecurityEvent,
  SecurityEventDocument,
} from '../../../../src/session/persistence/mongo/schemas/security-event.schema';
import { SecurityEventService } from '../../../../src/session/persistence/mongo/security-event.service';
import { FrozenClock, TEST_NOW } from '../../frozen-clock';
import { startMemoryReplSet } from '../../memory-replset';
import { bootSessionAuthority } from '../../session-authority-harness';
import {
  REFUSED_EVENT_SEED_ACTION,
  refuseSecurityEvents,
} from '../../transaction-failure';
import { RoleContractHarness } from './role-contract-harness';

const A_UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';
const ASSIGNMENT_ACTION = 'test.role-assigned';

export async function bootMongoRoleHarness(): Promise<RoleContractHarness> {
  const mongo = await startMemoryReplSet();
  const clock = new FrozenClock(TEST_NOW);
  const booted = await bootSessionAuthority(mongo.uri('role_contract'), clock);
  const { app, users, connection } = booted;
  connection.model(Role.name, RoleSchema);
  const roles = connection.model<RoleDocument>(Role.name);
  await roles.init();
  const events = app.get<Model<SecurityEventDocument>>(
    getModelToken(SecurityEvent.name),
  );
  const stores = mongoRoleStores({
    roleModel: roles,
    userModel: users,
    connection,
    events: app.get(SecurityEventService),
  });
  let accounts = 0;
  let assignments = 0;

  return {
    clock,
    catalog: stores.catalog,
    changes: stores.changes,
    sweeps: stores.sweeps,
    runner: (pause) => new MongoUnitOfWorkRunner(connection, pause),

    seedRole: async (role) => {
      const created = await roles.create({
        name: role.name,
        slug: role.slug,
        permissions: role.permissions,
        level: role.level,
        isSystemRole: role.isSystemRole ?? false,
        isProtected: role.isProtected ?? false,
        ...(role.createdAt
          ? { createdAt: role.createdAt, updatedAt: role.createdAt }
          : {}),
      });
      return created._id.toString();
    },
    seedAccount: async (account) => {
      accounts += 1;
      const user = await users.create({
        email: `role-contract-${accounts}@example.test`,
        name: 'Contract Tester',
        role: account.role,
        permissions: account.permissions ?? [],
        isVerified: true,
        sessionVersion: 0,
        isDeleted: account.deleted ?? false,
      });
      return user._id.toString();
    },
    seedAccounts: async (count, role) => {
      const first = accounts;
      accounts += count;
      const stored = await users.insertMany(
        Array.from({ length: count }, (_, index) => ({
          email: `role-contract-${first + index + 1}@example.test`,
          name: 'Contract Tester',
          role,
          isVerified: true,
          sessionVersion: 0,
        })),
        { lean: true },
      );
      return stored.map((user) => user._id.toString()).sort();
    },
    interruptRename: async (roleId, rename) => {
      const id = new Types.ObjectId(roleId);
      await roles.updateOne(
        { _id: id },
        {
          $set: {
            name: rename.name,
            slug: rename.slug,
            pendingHolderSweeps: [
              {
                roleId: id,
                previousSlug: rename.previousSlug,
                actorId: rename.actorId,
                sweepId: 'interrupted-rename',
              },
            ],
          },
        },
      );
    },

    oweRepair: async (ownerRoleId, repair) => {
      await roles.updateOne(
        { _id: new Types.ObjectId(ownerRoleId) },
        {
          $push: {
            pendingHolderSweeps: {
              ...repair,
              roleId: new Types.ObjectId(repair.roleId),
            },
          },
        },
        { timestamps: false },
      );
    },
    seedAssignment: async (assignment) => {
      assignments += 1;
      await events.create({
        eventId: `role-contract-assignment-${assignments}`,
        targetUserId: assignment.userId,
        action: ASSIGNMENT_ACTION,
        outcome: 'succeeded',
        occurredAt: clock.now(),
        roleAssignment: {
          assignedRoleId: assignment.assignedRoleId,
          previousRoleId: assignment.previousRoleId,
          sessionVersion: assignment.sessionVersion,
        },
      });
    },

    role: async (slug) => {
      const stored = await roles.findOne({ slug }).lean().exec();
      if (!stored) return null;
      return {
        id: stored._id.toString(),
        name: stored.name,
        slug: stored.slug,
        description: stored.description ?? null,
        level: stored.level ?? null,
        permissions: stored.permissions,
        isSystemRole: stored.isSystemRole,
        isProtected: stored.isProtected,
        owedRepairs: (stored.pendingHolderSweeps ?? []).map(
          (owed) => `${owed.previousSlug} for ${owed.roleId.toString()}`,
        ),
      };
    },
    account: async (userId) => {
      const user = await users.findById(userId).lean().exec();
      return user
        ? { role: user.role, sessionVersion: user.sessionVersion }
        : null;
    },
    events: async () => {
      const stored = await events
        .find({ action: { $ne: REFUSED_EVENT_SEED_ACTION } })
        .lean()
        .exec();
      return stored.map((event) => ({
        targetUserId: event.targetUserId ?? null,
        actorId: event.actorId ?? null,
        action: event.action,
        reasonCode: event.reasonCode ?? null,
      }));
    },

    absentId: () => new Types.ObjectId().toString(),
    foreignId: () => A_UUID,

    refuseSecurityEvents: () => refuseSecurityEvents(events, TEST_NOW),

    reset: async () => {
      await users.deleteMany({});
      await roles.deleteMany({});
      await events.deleteMany({});
    },
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
