import { MongoNetworkError } from 'mongodb';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UserRole } from '../../../user/enums/user-role.enum';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../../../admin/persistence/mongo/services/admin-round-four.harness-spec';

const PENDING_COUNTS = [15, 16] as const;

describe('pending role repairs have a storage bound', () => {
  const fixture = useAdminRoundFour('round_seven_pending_bound');
  for (const count of PENDING_COUNTS) {
    it(`handles a rename with ${count} unfinished repairs before commit`, async () => {
      const { h } = fixture;
      const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
      const refs = Array.from({ length: count }, (_, index) => ({
        roleId: role._id,
        previousSlug: `unfinished-${index}`,
        actorId: fixture.roleActorId,
      }));
      await h.roleModel.updateOne(
        { _id: role._id },
        { $set: { pendingHolderSweeps: refs } },
      );
      let written = false;
      const update = h.roleModel.collection.updateOne.bind(
        h.roleModel.collection,
      );
      jest
        .spyOn(h.roleModel.collection, 'updateOne')
        .mockImplementation(async (...args) => {
          const result = await update(...args);
          if (!Array.isArray(args[1]) && args[1]?.$set?.slug === LEAD_SLUG)
            written = true;
          return result;
        });
      const find = h.roleModel.collection.findOne.bind(h.roleModel.collection);
      jest
        .spyOn(h.roleModel.collection, 'findOne')
        .mockImplementation(async (...args) => {
          if (written && args[0]?._id)
            throw new MongoNetworkError('sweep unavailable');
          return find(...args);
        });
      const rename = h.roles.update(
        EDITOR_SLUG,
        { name: 'Content Lead' },
        fixture.roleActorId,
      );
      if (count === 15)
        await expect(rename).resolves.toMatchObject({ slug: LEAD_SLUG });
      else
        await expect(rename).rejects.toMatchObject({
          code: ErrorCode.AUTHORITY_UNAVAILABLE,
          status: 503,
        });
      jest.restoreAllMocks();
      const stored = await h.roleModel.findById(role._id).orFail();
      expect(stored.slug).toBe(count === 15 ? LEAD_SLUG : EDITOR_SLUG);
      expect(stored.pendingHolderSweeps).toHaveLength(16);
      expect(
        await h.events.countDocuments({ targetUserId: { $exists: true } }),
      ).toBe(0);
    });
  }
  it('rejects a delete before overflowing transferred pending work', async () => {
    const { h } = fixture;
    const role = await h.roleModel.findOne({ slug: EDITOR_SLUG }).orFail();
    const ref = {
      roleId: role._id,
      previousSlug: 'unfinished',
      actorId: fixture.roleActorId,
    };
    await h.roleModel.updateOne(
      { _id: role._id },
      { $set: { pendingHolderSweeps: [ref] } },
    );
    await h.roleModel.updateOne(
      { slug: UserRole.USER },
      {
        $set: {
          pendingHolderSweeps: Array.from({ length: 15 }, (_, index) => ({
            ...ref,
            previousSlug: `default-unfinished-${index}`,
          })),
        },
      },
    );
    await expect(
      h.roles.delete(EDITOR_SLUG, fixture.roleActorId),
    ).rejects.toMatchObject({
      code: ErrorCode.AUTHORITY_UNAVAILABLE,
      status: 503,
    });
    expect((await h.roleModel.findById(role._id))?.slug).toBe(EDITOR_SLUG);
    expect(
      (await h.roleModel.findOne({ slug: UserRole.USER }))?.pendingHolderSweeps,
    ).toHaveLength(15);
    expect(
      await h.events.countDocuments({ roleDeletionSweep: { $exists: true } }),
    ).toBe(0);
  });
});
