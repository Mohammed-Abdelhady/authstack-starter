import { ErrorCode } from '../../../../../common/enums/error-code.enum';
import { REVOKED_REASON } from '../../../../../session/constants/revoked-reason';
import { holdBefore, RaceGate } from '../../../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  OLD_SLUG,
  useAdminRoundFour,
} from '../admin-round-four.harness-spec';

const ASSIGNMENTS = 20;
const OPERATIONS = ['rename', 'delete'] as const;
const ORDERS = ['assignments first', 'edit first'] as const;

describe('bulk grant and role edit ordering', () => {
  const fixture = useAdminRoundFour('round_five_bulk');

  for (const operation of OPERATIONS) {
    for (const order of ORDERS) {
      it(`settles 20 assignments with ${operation} ${order}`, async () => {
        const { h } = fixture;
        const users = await Promise.all(
          Array.from({ length: ASSIGNMENTS }, (_, index) =>
            fixture.seed(`concurrent-${index}@example.test`, OLD_SLUG),
          ),
        );
        const gate = new RaceGate();
        const edit = () =>
          operation === 'rename'
            ? h.roles.update(
                EDITOR_SLUG,
                { name: 'Content Lead' },
                fixture.roleActorId,
              )
            : h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
        const restore =
          order === 'assignments first'
            ? operation === 'rename'
              ? holdBefore(h.roles, 'update', () => gate)
              : holdBefore(h.roles, 'delete', () => gate)
            : holdBefore(h.service, 'updateUserRole', () => gate);
        try {
          if (order === 'assignments first') {
            const pendingEdit = edit();
            const editSettled = Promise.allSettled([pendingEdit]);
            try {
              await gate.reached();
              const assignments = await Promise.all(
                users.map((user) => fixture.assign(user._id.toString())),
              );
              expect(assignments).toHaveLength(ASSIGNMENTS);
              expect(
                assignments.every(
                  (answer) => answer.data?.role === EDITOR_SLUG,
                ),
              ).toBe(true);
            } finally {
              gate.release();
              await editSettled;
            }
            if (operation === 'delete') {
              await expect(pendingEdit).rejects.toMatchObject({
                code: ErrorCode.ROLE_HAS_USERS,
                status: 400,
              });
            } else {
              await pendingEdit;
            }
          } else {
            const assignments = users.map((user) =>
              fixture.assign(user._id.toString()),
            );
            const settled = Promise.allSettled(assignments);
            try {
              await gate.reached(ASSIGNMENTS);
              await edit();
            } finally {
              gate.release();
              await settled;
            }
            for (const outcome of await settled) {
              expect(outcome).toMatchObject({
                status: 'rejected',
                reason: { code: ErrorCode.ROLE_NOT_FOUND, status: 404 },
              });
            }
          }
        } finally {
          restore();
        }

        const expectedRole =
          order === 'edit first'
            ? OLD_SLUG
            : operation === 'rename'
              ? LEAD_SLUG
              : EDITOR_SLUG;
        const expectedVersion =
          order === 'edit first' ? 0 : operation === 'rename' ? 2 : 1;
        const expectedEvents = expectedVersion;
        for (const user of users) {
          const stored = await h.users.findById(user._id);
          expect(stored?.role).toBe(expectedRole);
          expect(stored?.sessionVersion).toBe(expectedVersion);
          const events = await h.events
            .find({ targetUserId: user._id.toString() })
            .sort({ _id: 1 })
            .lean();
          expect(events).toHaveLength(expectedEvents);
          expect(
            events.map((event) => ({
              actorId: event.actorId,
              reasonCode: event.reasonCode,
            })),
          ).toEqual(
            order === 'edit first'
              ? []
              : operation === 'rename'
                ? [fixture.actorId, fixture.roleActorId].map((actorId) => ({
                    actorId,
                    reasonCode: REVOKED_REASON.ADMIN_FORCED,
                  }))
                : [
                    {
                      actorId: fixture.actorId,
                      reasonCode: REVOKED_REASON.ADMIN_FORCED,
                    },
                  ],
          );
        }
        expect(await h.users.countDocuments({ role: expectedRole })).toBe(
          ASSIGNMENTS,
        );
        expect(
          await h.roleModel.findOne({ slug: expectedRole }),
        ).not.toBeNull();
      });
    }
  }
});
