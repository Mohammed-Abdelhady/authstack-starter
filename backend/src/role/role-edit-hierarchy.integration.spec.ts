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

  it('protects the admin description and wildcard from administrator edits', async () => {
    await expect(
      fixture.h.roles.update(
        UserRole.ADMIN,
        { description: DESCRIPTION },
        fixture.actorId,
      ),
    ).rejects.toMatchObject({ code: 'ROLE_PROTECTED', status: 403 });
    const stored = await fixture.h.roleModel
      .findOne({ slug: UserRole.ADMIN })
      .exec();
    expect(stored?.description).toBeUndefined();
    expect(stored?.permissions).toEqual([WILDCARD_PERMISSION]);
  });

  it.each([
    { slug: UserRole.MANAGER, refusal: HIERARCHY_REFUSAL },
    {
      slug: UserRole.ADMIN,
      refusal: { code: 'ROLE_PROTECTED', status: 403 },
    },
  ])(
    'refuses a manager editing the $slug description',
    async ({ slug, refusal }) => {
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
      ).rejects.toMatchObject(refusal);
      const after = await fixture.h.roleModel.findOne({ slug }).exec();
      expect(after?.description).toBe(before?.description);
      expect(after?.permissions).toEqual(
        slug === UserRole.ADMIN ? [WILDCARD_PERMISSION] : [],
      );
    },
  );
});
