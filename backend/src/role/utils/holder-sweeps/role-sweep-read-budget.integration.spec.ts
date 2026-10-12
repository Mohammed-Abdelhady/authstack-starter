import {
  Role,
  RoleDocument,
} from '../../persistence/mongo/schemas/role.schema';
import { Logger } from '@nestjs/common';
import { UserRole } from '../../../user/enums/user-role.enum';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import { sweepRoleHolders } from '../../../../test/utils/role/mongo-role-holder-sweeps';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

const LIVE_HOLDERS = 1000;

describe('sweep reads only stale holders', () => {
  const fixture = useAdminRoundFour('round_nine_read_budget');
  it('returns one stale document and no live destination holders from the driver', async () => {
    const { h } = fixture;
    await h.users.insertMany(
      Array.from({ length: LIVE_HOLDERS }, (_, index) => ({
        email: `live-${index}@example.test`,
        name: 'Live Holder',
        role: UserRole.USER,
        isVerified: true,
        sessionVersion: 0,
      })),
    );
    const straggler = await fixture.seed('stale@example.test', EDITOR_SLUG);
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    await h.roleModel.deleteOne({ _id: role._id });
    const returned: number[] = [];
    const fields: string[][] = [];
    const find = h.users.collection.find.bind(h.users.collection);
    jest.spyOn(h.users.collection, 'find').mockImplementation((...args) => {
      const cursor = find(...args);
      if (args[0]?.role && !args[0]?._id) {
        const read = cursor.toArray.bind(cursor);
        jest.spyOn(cursor, 'toArray').mockImplementationOnce(async () => {
          const documents = await read();
          returned.push(documents.length);
          fields.push(
            ...documents.map((document) => Object.keys(document).sort()),
          );
          return documents;
        });
      }
      return cursor;
    });
    const moved = await sweepRoleHolders({
      connection: h.connection,
      roleModel: h.connection.model<RoleDocument>(Role.name),
      userModel: h.users,
      events: h.app.get(SecurityEventService),
      roleId: role._id,
      previousSlug: EDITOR_SLUG,
      actorId: fixture.roleActorId,
      logger: new Logger('SweepReadBudget'),
    });
    expect(returned).toEqual([1, 0]);
    expect(fields).toEqual([['_id', 'role']]);
    expect(moved).toBe(1);
    expect((await h.users.findById(straggler._id))?.role).toBe(UserRole.USER);
    expect((await h.users.findById(straggler._id))?.sessionVersion).toBe(1);
    expect(
      await h.events.countDocuments({ targetUserId: straggler._id.toString() }),
    ).toBe(1);
    expect(
      await h.users.countDocuments({ role: UserRole.USER, sessionVersion: 0 }),
    ).toBe(1000);
  });
});
