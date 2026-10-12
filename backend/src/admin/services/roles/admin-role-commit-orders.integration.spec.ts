import { UserRole } from '../../../user/enums/user-role.enum';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { REVOKED_REASON } from '../../../session/constants/revoked-reason';
import { holdBefore, RaceGate } from '../../../../test/utils/race-gate';
import {
  EDITOR_SLUG,
  LEAD_SLUG,
  useAdminRoundFour,
} from '../../persistence/mongo/services/admin-round-four.harness-spec';

const HOLDER_COUNT = 300;
const OPERATIONS = ['rename', 'delete'] as const;
const CALLERS = ['assignment', 'creation'] as const;

describe('role edits and assignments cover both commit orders', () => {
  const fixture = useAdminRoundFour('round_four_orders');

  for (const operation of OPERATIONS) {
    for (const caller of CALLERS) {
      it(`${caller} and ${operation} honor grant authority ordering`, async () => {
        const { h } = fixture;
        const target = await fixture.seed('target@example.test');
        if (operation === 'rename') {
          await h.users.collection.insertMany(
            Array.from({ length: HOLDER_COUNT }, (_, index) => ({
              email: `holder-${index}@example.test`,
              name: 'Holder',
              role: EDITOR_SLUG,
              isVerified: true,
              isDeleted: false,
              sessionVersion: 0,
            })),
          );
        }
        const gate = new RaceGate();
        let restore: () => void = () => undefined;
        if (operation === 'rename') {
          restore = holdBefore(h.roles, 'update', () => gate);
        } else {
          const original = h.roleModel.collection.deleteOne.bind(
            h.roleModel.collection,
          );
          jest
            .spyOn(h.roleModel.collection, 'deleteOne')
            .mockImplementationOnce(async (...args) => {
              await gate.hold();
              return original(...args);
            });
        }
        const edit =
          operation === 'rename'
            ? h.roles.update(
                EDITOR_SLUG,
                { name: 'Content Lead' },
                fixture.roleActorId,
              )
            : h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
        try {
          await gate.reached();
          if (caller === 'assignment') {
            if (operation === 'delete') {
              await expect(
                fixture.assign(target._id.toString()),
              ).rejects.toMatchObject({
                code: ErrorCode.AUTHORITY_UNAVAILABLE,
                status: 503,
              });
            } else {
              await fixture.assign(target._id.toString());
            }
          } else {
            if (operation === 'delete') {
              await expect(
                fixture.create('created@example.test'),
              ).rejects.toMatchObject({
                code: ErrorCode.AUTHORITY_UNAVAILABLE,
                status: 503,
              });
            } else {
              await fixture.create('created@example.test');
            }
          }
        } finally {
          gate.release();
          await edit;
          restore();
        }
        if (operation === 'delete') {
          expect((await h.users.findById(target._id))?.role).toBe(
            UserRole.USER,
          );
          expect((await h.users.findById(target._id))?.sessionVersion).toBe(0);
          expect(
            await h.users.countDocuments({ email: 'created@example.test' }),
          ).toBe(0);
          expect(
            await h.events.countDocuments({
              targetUserId: target._id.toString(),
            }),
          ).toBe(0);
          expect(await h.roleModel.findOne({ slug: EDITOR_SLUG })).toBeNull();
          return;
        }
        const stored = await h.users.findOne({
          email:
            caller === 'assignment'
              ? 'target@example.test'
              : 'created@example.test',
        });
        expect(stored?.role).toBe(
          operation === 'rename' ? LEAD_SLUG : UserRole.USER,
        );
        expect(
          await h.roleModel.findOne({ slug: stored?.role }),
        ).not.toBeNull();
        expect(stored?.sessionVersion).toBe(caller === 'assignment' ? 2 : 1);
        const events = await h.events
          .find({ targetUserId: stored?._id.toString() })
          .lean();
        expect(events).toHaveLength(caller === 'assignment' ? 2 : 1);
        expect(
          events.map((event) => ({
            actorId: event.actorId,
            reasonCode: event.reasonCode,
          })),
        ).toEqual(
          caller === 'assignment'
            ? [
                {
                  actorId: fixture.actorId,
                  reasonCode: REVOKED_REASON.ADMIN_FORCED,
                },
                {
                  actorId: fixture.roleActorId,
                  reasonCode: REVOKED_REASON.ADMIN_FORCED,
                },
              ]
            : [
                {
                  actorId: fixture.roleActorId,
                  reasonCode: REVOKED_REASON.ADMIN_FORCED,
                },
              ],
        );
      });

      it(`${operation} refuses while the ${caller} grant holds authority`, async () => {
        const { h } = fixture;
        const target = await fixture.seed('target@example.test');
        const gate = new RaceGate();
        if (caller === 'assignment') {
          const original = h.users.collection.updateOne.bind(
            h.users.collection,
          );
          let held = false;
          jest
            .spyOn(h.users.collection, 'updateOne')
            .mockImplementation(async (...args) => {
              if (
                !held &&
                !Array.isArray(args[1]) &&
                args[1]?.$set?.role === EDITOR_SLUG
              ) {
                held = true;
                await gate.hold();
              }
              return original(...args);
            });
        } else {
          const original = h.users.collection.insertOne.bind(
            h.users.collection,
          );
          jest
            .spyOn(h.users.collection, 'insertOne')
            .mockImplementationOnce(async (...args) => {
              await gate.hold();
              return original(...args);
            });
        }
        const request =
          caller === 'assignment'
            ? fixture.assign(target._id.toString())
            : fixture.create('created@example.test');
        const settled = Promise.allSettled([request]);
        try {
          await gate.reached();
          if (operation === 'rename') {
            await expect(
              h.roles.update(
                EDITOR_SLUG,
                { name: 'Content Lead' },
                fixture.roleActorId,
              ),
            ).rejects.toMatchObject({
              code: ErrorCode.AUTHORITY_UNAVAILABLE,
              status: 503,
            });
          } else {
            await expect(
              h.roles.delete(EDITOR_SLUG, fixture.roleActorId),
            ).rejects.toMatchObject({
              code: ErrorCode.AUTHORITY_UNAVAILABLE,
              status: 503,
            });
          }
        } finally {
          gate.release();
          await settled;
        }
        const answer = await request;
        expect(answer.data?.role).toBe(EDITOR_SLUG);
        const stored = await h.users.findOne({
          email:
            caller === 'assignment'
              ? 'target@example.test'
              : 'created@example.test',
        });
        expect(stored?.role).toBe(EDITOR_SLUG);
        expect(await h.roleModel.findOne({ slug: EDITOR_SLUG })).not.toBeNull();
        expect(stored?.sessionVersion).toBe(caller === 'assignment' ? 1 : 0);
        const grantEvents = await h.events
          .find({ targetUserId: stored?._id.toString() })
          .lean();
        expect(
          grantEvents.map((event) => ({
            actorId: event.actorId,
            reasonCode: event.reasonCode,
          })),
        ).toEqual(
          caller === 'assignment'
            ? [
                {
                  actorId: fixture.actorId,
                  reasonCode: REVOKED_REASON.ADMIN_FORCED,
                },
              ]
            : [],
        );
        if (operation === 'delete') {
          if (!stored) throw new Error('grant did not persist its target');
          await fixture.assign(stored._id.toString(), UserRole.USER);
          await h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
          expect((await h.users.findById(stored._id))?.role).toBe(
            UserRole.USER,
          );
          expect(await h.roleModel.findOne({ slug: EDITOR_SLUG })).toBeNull();
        } else {
          await h.roles.update(
            EDITOR_SLUG,
            { name: 'Content Lead' },
            fixture.roleActorId,
          );
          expect((await h.users.findById(stored?._id))?.role).toBe(LEAD_SLUG);
        }
        expect(
          await h.roleModel.findOne({ slug: UserRole.USER }),
        ).not.toBeNull();
      });
    }
  }
});
