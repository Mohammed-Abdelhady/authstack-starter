import {
  ROLE_PERMISSIONS,
  WILDCARD_PERMISSION,
} from '../common/constants/permissions';
import { ErrorCode } from '../common/enums/error-code.enum';
import { UserRole } from '../user/enums/user-role.enum';
import { useAdminRoundFour } from '../admin/persistence/mongo/services/admin-round-four.harness-spec';

const DESCRIPTION = 'Updated role description';
const HIERARCHY_REFUSAL = {
  code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
  status: 403,
};

describe('role edits respect wildcard authority and hierarchy', () => {
  const fixture = useAdminRoundFour('role_edit_hierarchy');

  it('lets an admin edit the admin description while keeping the wildcard', async () => {
    await fixture.h.roles.update(
      UserRole.ADMIN,
      { description: DESCRIPTION },
      fixture.actorId,
    );
    const stored = await fixture.h.roleModel
      .findOne({ slug: UserRole.ADMIN })
      .exec();
    expect(stored?.description).toBe(DESCRIPTION);
    expect(stored?.permissions).toEqual([WILDCARD_PERMISSION]);
  });

  it.each([UserRole.MANAGER, UserRole.ADMIN])(
    'refuses a manager editing the %s description',
    async (slug) => {
      const manager = await fixture.seed(
        'edit-manager@example.test',
        UserRole.MANAGER,
      );
      await fixture.h.users.updateOne(
        { _id: manager._id },
        { $set: { permissions: [ROLE_PERMISSIONS.UPDATE_ALL] } },
      );
      const before = await fixture.h.roleModel.findOne({ slug }).exec();
      await expect(
        fixture.h.roles.update(
          slug,
          { description: DESCRIPTION },
          manager._id.toString(),
        ),
      ).rejects.toMatchObject(HIERARCHY_REFUSAL);
      const after = await fixture.h.roleModel.findOne({ slug }).exec();
      expect(after?.description).toBe(before?.description);
      expect(after?.permissions).toEqual(
        slug === UserRole.ADMIN ? [WILDCARD_PERMISSION] : [],
      );
    },
  );
});
