import { ErrorCode } from '../../../common/enums/error-code.enum';
import { UserRole } from '../../../user/enums/user-role.enum';
import { UserDocument } from '../../../user/persistence/mongo/schemas/user.schema';
import { useAdminRoundFour } from '../../persistence/mongo/services/admin-round-four.harness-spec';

const ORIGINAL_NAME = 'Target';
const NEW_NAME = 'Renamed Target';

describe('admin name update rechecks actor and target in its transaction', () => {
  const fixture = useAdminRoundFour('admin_update_fresh');
  let manager: UserDocument;
  let target: UserDocument;

  beforeEach(async () => {
    manager = await fixture.seed(
      'update-manager@example.test',
      UserRole.MANAGER,
    );
    target = await fixture.seed('update-target@example.test', UserRole.USER);
  });

  function rename() {
    return fixture.h.service.updateUser(
      target._id.toString(),
      { name: NEW_NAME },
      manager._id.toString(),
      UserRole.MANAGER,
    );
  }

  async function storedName(): Promise<string | undefined> {
    return (await fixture.h.users.findById(target._id).exec())?.name;
  }

  it('stores the new name for a target below the actor', async () => {
    const result = await rename();

    expect(result.data?.name).toBe(NEW_NAME);
    expect(await storedName()).toBe(NEW_NAME);
  });

  it('refuses when the target is promoted above the actor before the write', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.collection.updateOne(
        { _id: target._id },
        { $set: { role: UserRole.ADMIN } },
      );
    });

    await expect(rename()).rejects.toMatchObject({
      code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      status: 403,
    });

    expect(await storedName()).toBe(ORIGINAL_NAME);
  });

  it('refuses when the actor is demoted to the target level before the write', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.collection.updateOne(
        { _id: manager._id },
        { $set: { role: UserRole.USER } },
      );
    });

    await expect(rename()).rejects.toMatchObject({
      code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      status: 403,
    });

    expect(await storedName()).toBe(ORIGINAL_NAME);
  });

  it('refuses when the actor is deactivated before the write', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.collection.updateOne(
        { _id: manager._id },
        { $set: { isDeleted: true } },
      );
    });

    await expect(rename()).rejects.toMatchObject({
      code: ErrorCode.SESSION_INVALID,
      status: 401,
    });

    expect(await storedName()).toBe(ORIGINAL_NAME);
  });

  it('answers not found when the target is deactivated before the write', async () => {
    fixture.beforeTransaction(async () => {
      await fixture.h.users.collection.updateOne(
        { _id: target._id },
        { $set: { isDeleted: true } },
      );
    });

    await expect(rename()).rejects.toMatchObject({
      code: ErrorCode.USER_NOT_FOUND,
      status: 404,
    });

    expect(await storedName()).toBe(ORIGINAL_NAME);
  });
});
