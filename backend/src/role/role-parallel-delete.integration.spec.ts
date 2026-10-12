import { UserRole } from '../user/enums/user-role.enum';
import { holdBefore, RaceGate } from '../../test/utils/race-gate';
import { useAdminRoundFour } from '../admin/persistence/mongo/services/admin-round-four.harness-spec';

const PARALLEL_DELETES = 20;

describe('independent role deletes remain independent', () => {
  const fixture = useAdminRoundFour('round_seven_parallel_delete');
  it('deletes twenty unrelated roles without failures or default-role writes', async () => {
    const { h } = fixture;
    const roles = await h.roleModel.create(
      Array.from({ length: PARALLEL_DELETES }, (_, index) => ({
        name: `Independent ${index}`,
        slug: `independent-${index}`,
        permissions: [],
      })),
    );
    const fallback = await h.roleModel
      .findOne({ slug: UserRole.USER })
      .orFail();
    const gate = new RaceGate();
    const restore = holdBefore(h.roles, 'delete', () => gate);
    const requests = roles.map((role) =>
      h.roles.delete(role.slug, fixture.roleActorId),
    );
    const settled = Promise.allSettled(requests);
    try {
      await Promise.race([
        gate.reached(PARALLEL_DELETES),
        ...requests.map((request) =>
          request.then(
            () => undefined,
            () => undefined,
          ),
        ),
      ]);
    } finally {
      gate.release();
      restore();
    }
    const results = await settled;
    expect(results.filter((result) => result.status === 'rejected')).toEqual(
      [],
    );
    expect(results.map((result) => result.status)).toEqual(
      Array.from({ length: PARALLEL_DELETES }, () => 'fulfilled'),
    );
    expect(await h.roleModel.countDocuments({ slug: /^independent-/ })).toBe(0);
    const stored = await h.roleModel.findById(fallback._id).orFail();
    expect(stored.slug).toBe(UserRole.USER);
    expect(stored.__v).toBe(0);
    expect(stored.pendingHolderSweeps).toEqual([]);
  });
});
