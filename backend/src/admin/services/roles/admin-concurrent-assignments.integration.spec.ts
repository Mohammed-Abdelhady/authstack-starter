import { Logger } from '@nestjs/common';
import { UserRole } from '../../../user/enums/user-role.enum';
import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../../persistence/mongo/services/admin-round-four.harness-spec';

const CONCURRENT_ASSIGNMENTS = 30;

describe('admin role assignment reconciliation under contention', () => {
  const fixture = useAdminRoundFour('admin_concurrent_assignments');
  let users: Awaited<ReturnType<typeof fixture.seedMany>>;

  beforeEach(async () => {
    users = await fixture.seedMany(
      Array.from(
        { length: CONCURRENT_ASSIGNMENTS },
        (_, index) => `concurrent-${index}@example.test`,
      ),
    );
  });

  it('lets concurrent assignments of one role to different users all succeed', async () => {
    const { h } = fixture;
    const writes = new RaceGate();
    const restore = holdBefore(h.service, 'updateUserRole', () => writes);
    const log = jest.spyOn(Logger.prototype, 'error');
    const requests = users.map((user) => fixture.assign(user._id.toString()));
    const settled = Promise.allSettled(requests);
    try {
      await Promise.race([
        writes.reached(CONCURRENT_ASSIGNMENTS),
        ...requests.map((request) =>
          request.then(
            () => undefined,
            () => undefined,
          ),
        ),
      ]);
    } finally {
      writes.release();
      restore();
    }
    const results = await settled;
    const targetIds = users.map((user) => user._id.toString());
    const [storedUsers, eventCounts, editorCount, userRoleCount] =
      await Promise.all([
        h.users
          .find({ _id: { $in: users.map((user) => user._id) } })
          .select({ _id: 1, role: 1, sessionVersion: 1 })
          .lean(),
        h.events.aggregate<{ _id: string; count: number }>([
          { $match: { targetUserId: { $in: targetIds } } },
          { $group: { _id: '$targetUserId', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        h.users.countDocuments({ role: EDITOR_SLUG }),
        h.users.countDocuments({ role: UserRole.USER }),
      ]);
    const storedById = new Map(
      storedUsers.map((user) => [user._id.toString(), user]),
    );
    const eventsByTargetId = new Map(
      eventCounts.map((event) => [event._id, event.count]),
    );
    const rejected = [];
    for (const [index, result] of results.entries()) {
      if (result.status !== 'rejected') continue;
      const user = users[index];
      const stored = storedById.get(user._id.toString());
      const error: unknown = result.reason;
      rejected.push({
        userId: user._id.toString(),
        error,
        storedRole: stored?.role,
        sessionVersion: stored?.sessionVersion,
        events: eventsByTargetId.get(user._id.toString()) ?? 0,
      });
    }
    expect({
      rejected,
      authorityLogs: rejected.length ? log.mock.calls : [],
    }).toEqual({ rejected: [], authorityLogs: [] });
    expect(results.map((result) => result.status)).toEqual(
      Array.from({ length: CONCURRENT_ASSIGNMENTS }, () => 'fulfilled'),
    );
    expect(editorCount).toBe(30);
    expect(userRoleCount).toBe(0);
    expect(
      storedUsers
        .map((user) => ({
          id: user._id.toString(),
          role: user.role,
          sessionVersion: user.sessionVersion,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    ).toEqual(
      [...targetIds]
        .sort()
        .map((id) => ({ id, role: EDITOR_SLUG, sessionVersion: 1 })),
    );
    expect(eventCounts).toEqual(
      [...targetIds].sort().map((id) => ({ _id: id, count: 1 })),
    );
  });
});
