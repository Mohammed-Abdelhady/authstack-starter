import {
  ROLE_PERMISSIONS,
  USER_PERMISSIONS,
  WILDCARD_PERMISSION,
} from '../common/constants/permissions';
import { ErrorCode } from '../common/enums/error-code.enum';
import { UserRole } from '../user/enums/user-role.enum';
import { UserDocument } from '../user/persistence/mongo/schemas/user.schema';
import {
  EDITOR_SLUG,
  useAdminRoundFour,
} from '../admin/persistence/mongo/services/admin-round-four.harness-spec';

const NEW_ROLE_NAME = 'Grant Ceiling';
const NEW_ROLE_SLUG = 'grant-ceiling';
const EXISTING_PERMISSION = 'posts:read:all';
const FORBIDDEN = { code: ErrorCode.FORBIDDEN, status: 403 };
const HIERARCHY_REFUSAL = {
  code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
  status: 403,
};

describe('role grants use fresh permissions and strict hierarchy', () => {
  const fixture = useAdminRoundFour('role_grant_ceiling');
  let manager: UserDocument;

  beforeEach(async () => {
    manager = await fixture.seed(
      'ceiling-manager@example.test',
      UserRole.MANAGER,
    );
    await fixture.h.users.updateOne(
      { _id: manager._id },
      {
        $set: {
          permissions: [
            ROLE_PERMISSIONS.CREATE_ALL,
            ROLE_PERMISSIONS.UPDATE_ALL,
            USER_PERMISSIONS.READ_ALL,
          ],
        },
      },
    );
  });

  function create(permissions: string[], actorId = manager._id.toString()) {
    return fixture.h.roles.create(
      { name: NEW_ROLE_NAME, permissions },
      actorId,
    );
  }

  function update(
    permissions: string[],
    slug: string = EDITOR_SLUG,
    actorId = manager._id.toString(),
  ) {
    return fixture.h.roles.update(slug, { permissions }, actorId);
  }

  async function storedPermissions(slug: string = EDITOR_SLUG) {
    return (await fixture.h.roleModel.findOne({ slug }).exec())?.permissions;
  }

  it('lets a wildcard holder create a role with wildcard and other grants', async () => {
    await create(
      [WILDCARD_PERMISSION, USER_PERMISSIONS.READ_ALL],
      fixture.actorId,
    );
    expect(await storedPermissions(NEW_ROLE_SLUG)).toEqual([
      WILDCARD_PERMISSION,
      USER_PERMISSIONS.READ_ALL,
    ]);
  });

  it('creates a role from direct grants', async () => {
    await create([USER_PERMISSIONS.READ_ALL]);
    expect(await storedPermissions(NEW_ROLE_SLUG)).toEqual([
      USER_PERMISSIONS.READ_ALL,
    ]);
  });

  it('creates a role from inherited grants', async () => {
    await fixture.h.users.updateOne(
      { _id: manager._id },
      { $set: { permissions: [] } },
    );
    await fixture.h.roleModel.updateOne(
      { slug: UserRole.MANAGER },
      {
        $set: {
          permissions: [ROLE_PERMISSIONS.CREATE_ALL, USER_PERMISSIONS.READ_ALL],
        },
      },
    );
    await create([USER_PERMISSIONS.READ_ALL]);
    expect(await storedPermissions(NEW_ROLE_SLUG)).toEqual([
      USER_PERMISSIONS.READ_ALL,
    ]);
  });

  it.each([
    [WILDCARD_PERMISSION],
    [USER_PERMISSIONS.READ_ALL, USER_PERMISSIONS.DELETE_ALL],
  ])(
    'refuses creating an unheld grant %j',
    async (...permissions: string[]) => {
      await expect(create(permissions)).rejects.toMatchObject(FORBIDDEN);
      expect(await storedPermissions(NEW_ROLE_SLUG)).toBeUndefined();
    },
  );

  it('refuses a grant lost before the create transaction', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.updateOne(
        { _id: manager._id },
        { $pull: { permissions: USER_PERMISSIONS.READ_ALL } },
      );
    });
    await expect(create([USER_PERMISSIONS.READ_ALL])).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(await storedPermissions(NEW_ROLE_SLUG)).toBeUndefined();
  });

  it('refuses creation when create authority was lost before the transaction', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.updateOne(
        { _id: manager._id },
        { $pull: { permissions: ROLE_PERMISSIONS.CREATE_ALL } },
      );
    });
    await expect(create([])).rejects.toMatchObject(HIERARCHY_REFUSAL);
    expect(await storedPermissions(NEW_ROLE_SLUG)).toBeUndefined();
  });

  it.each([UserRole.MANAGER, UserRole.ADMIN])(
    'refuses editing own or higher role %s',
    async (slug) => {
      await expect(update([WILDCARD_PERMISSION], slug)).rejects.toMatchObject(
        HIERARCHY_REFUSAL,
      );
      expect(await storedPermissions(slug)).toEqual(
        slug === UserRole.ADMIN ? [WILDCARD_PERMISSION] : [],
      );
    },
  );

  it('refuses adding wildcard to a lower role', async () => {
    await expect(
      update([EXISTING_PERMISSION, WILDCARD_PERMISSION]),
    ).rejects.toMatchObject(FORBIDDEN);
    expect(await storedPermissions()).toEqual([EXISTING_PERMISSION]);
  });

  it('refuses a grant lost before the update transaction', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.updateOne(
        { _id: manager._id },
        { $pull: { permissions: USER_PERMISSIONS.READ_ALL } },
      );
    });
    await expect(
      update([EXISTING_PERMISSION, USER_PERMISSIONS.READ_ALL]),
    ).rejects.toMatchObject(FORBIDDEN);
    expect(await storedPermissions()).toEqual([EXISTING_PERMISSION]);
  });

  it('adds a held grant while retaining an existing unheld permission', async () => {
    await update([EXISTING_PERMISSION, USER_PERMISSIONS.READ_ALL]);
    expect(await storedPermissions()).toEqual([
      EXISTING_PERMISSION,
      USER_PERMISSIONS.READ_ALL,
    ]);
  });

  it('lets a wildcard holder add permissions to a lower role', async () => {
    await update(
      [EXISTING_PERMISSION, USER_PERMISSIONS.DELETE_ALL],
      EDITOR_SLUG,
      fixture.actorId,
    );
    expect(await storedPermissions()).toEqual([
      EXISTING_PERMISSION,
      USER_PERMISSIONS.DELETE_ALL,
    ]);
  });
});
