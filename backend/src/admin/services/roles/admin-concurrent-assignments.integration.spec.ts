import { Logger } from '@nestjs/common';
import { UserRole } from '../../../user/enums/user-role.enum';
import { RaceGate } from '../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../../persistence/mongo/services/admin-round-four.harness-spec';

const CONCURRENT_ASSIGNMENTS = 30;

describe('admin role assignment reconciliation under contention', () => {
  const fixture = useAdminRoundFour('admin_concurrent_assignments');
  it('lets concurrent assignments of one role to different users all succeed', async () => {
    const { h } = fixture;
    const users = await Promise.all(
      Array.from({ length: CONCURRENT_ASSIGNMENTS }, (_, index) =>
        fixture.seed(`concurrent-${index}@example.test`),
      ),
    );
    const writes = new RaceGate();
    const original = h.users.collection.updateOne.bind(h.users.collection);
    jest
      .spyOn(h.users.collection, 'updateOne')
      .mockImplementation(async (...args) => {
        if (!Array.isArray(args[1]) && args[1]?.$set?.role === EDITOR_SLUG) {
          await writes.hold();
        }
        return original(...args);
      });
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
    }
    const results = await settled;
    const rejected = [];
    for (const [index, result] of results.entries()) {
      if (result.status !== 'rejected') continue;
      const user = users[index];
      const stored = await h.users.findById(user._id);
      const error: unknown = result.reason;
      rejected.push({
        userId: user._id.toString(),
        error,
        storedRole: stored?.role,
        sessionVersion: stored?.sessionVersion,
        events: await h.events.countDocuments({
          targetUserId: user._id.toString(),
        }),
      });
    }
    expect({
      rejected,
      authorityLogs: rejected.length ? log.mock.calls : [],
    }).toEqual({ rejected: [], authorityLogs: [] });
    expect(results.map((result) => result.status)).toEqual(
      Array.from({ length: CONCURRENT_ASSIGNMENTS }, () => 'fulfilled'),
    );
    expect(await h.users.countDocuments({ role: EDITOR_SLUG })).toBe(30);
    for (const user of users) {
      expect((await h.users.findById(user._id))?.sessionVersion).toBe(1);
      expect(
        await h.events.countDocuments({ targetUserId: user._id.toString() }),
      ).toBe(1);
    }
    expect(await h.users.countDocuments({ role: UserRole.USER })).toBe(0);
  });
});
