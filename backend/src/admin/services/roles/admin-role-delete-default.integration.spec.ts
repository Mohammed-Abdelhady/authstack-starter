import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UserRole } from '../../../user/enums/user-role.enum';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../../persistence/mongo/services/admin-round-four.harness-spec';

const ORDERS = ['before request', 'after request admission'] as const;

describe('role deletion requires the default role at its transaction snapshot', () => {
  const fixture = useAdminRoundFour('round_five_delete_default');
  for (const order of ORDERS) {
    it(`does not delete when the default disappears ${order}`, async () => {
      const { h } = fixture;
      const fallback = await h.roleModel
        .findOne({ slug: UserRole.USER })
        .orFail();
      if (order === 'before request') {
        await h.roleModel.collection.deleteOne({ _id: fallback._id });
      } else {
        fixture.beforeTransaction(async () => {
          await h.roleModel.collection.deleteOne({ _id: fallback._id });
        });
      }
      const request = h.roles.delete(EDITOR_SLUG, fixture.roleActorId);
      await expect(request).rejects.toMatchObject({
        code: ErrorCode.ROLE_NOT_FOUND,
        status: 404,
      });
      expect(await h.roleModel.findOne({ slug: EDITOR_SLUG })).not.toBeNull();
      expect(await h.events.countDocuments({})).toBe(0);
    });
  }
});
