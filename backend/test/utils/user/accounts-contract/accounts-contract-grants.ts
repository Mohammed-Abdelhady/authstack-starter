import * as bcrypt from 'bcrypt';
import { holdAddress } from '../../address-claim';
import { AccountCreationPolicy } from '../../../../src/auth/services/registration/account-creation-policy';
import { ACCOUNT_CREATION_METHOD } from '../../../../src/auth/constants/account-creation';
import { ErrorCode } from '../../../../src/common/enums/error-code.enum';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  MANAGER_SLUG,
  READ_POSTS,
  READ_USERS,
  refusalOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const NEW_SECRET = 'CreatedPassword123!';

/** Accounts an admin creates, and the permissions an admin grants. */
export function accountGrantCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('creates a verified account with a hashed password', async () => {
    const { adminId } = fixture();
    const policy = new AccountCreationPolicy();
    const check = jest.spyOn(policy, 'assertMayCreate');
    const inserting = jest.spyOn(harness().admin, 'insertAccount');

    const services = servicesOn(harness(), undefined, policy);
    const created = await services.adminCreate.createUser(
      {
        email: '  Created@Example.Test ',
        name: 'Created Person',
        password: NEW_SECRET,
        role: EDITOR_SLUG,
      },
      ADMIN_SLUG,
      adminId,
    );

    expect(check.mock.calls).toEqual([
      [
        { application: null, method: ACCOUNT_CREATION_METHOD.STAFF },
        inserting.mock.calls[0]?.[0],
      ],
    ]);
    const id = created.data?.id ?? '';
    expect(await harness().accountIdByEmail('created@example.test')).toBe(id);
    const stored = await storedAccount(harness(), id);
    expect(stored).toMatchObject({
      email: 'created@example.test',
      name: 'Created Person',
      role: EDITOR_SLUG,
      permissions: [],
      isVerified: true,
      isDeleted: false,
      authProvider: 'email',
      primaryProvider: 'email',
      sessionVersion: 0,
    });
    expect(await bcrypt.compare(NEW_SECRET, stored.passwordHash ?? '')).toBe(
      true,
    );
    expect(created.data).toMatchObject({ id, role: EDITOR_SLUG });
  });

  it('refuses an actor whose stored authority no longer allows the role before asking the creation policy', async () => {
    const { userId } = fixture();
    const policy = new AccountCreationPolicy();
    const check = jest.spyOn(policy, 'assertMayCreate');
    const services = servicesOn(harness(), undefined, policy);
    const email = 'stale-authority-creation@example.test';

    await expect(
      services.adminCreate.createUser(
        {
          email,
          name: 'Refused Account',
          password: NEW_SECRET,
          role: DEFAULT_SLUG,
        },
        ADMIN_SLUG,
        userId,
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    });
    expect(check).not.toHaveBeenCalled();
    expect(await harness().accountIdByEmail(email)).toBeNull();
  });

  it('refuses a taken address before and during the insert', async () => {
    const { adminId } = fixture();
    const services = servicesOn(harness());
    const create = (email: string): Promise<unknown> =>
      services.adminCreate.createUser(
        { email, name: 'Second', password: NEW_SECRET, role: DEFAULT_SLUG },
        ADMIN_SLUG,
        adminId,
      );
    const TAKEN = { code: 'EMAIL_ALREADY_EXISTS', status: 409 };

    expect(await refusalOf(create('PERSON@example.test'))).toEqual(TAKEN);
    await holdAddress(
      harness().ledger,
      harness().runner(() => Promise.resolve()),
      harness().clock,
      'held-create@example.test',
    );
    expect(await refusalOf(create('held-create@example.test'))).toEqual(TAKEN);
    expect(
      await harness().accountIdByEmail('held-create@example.test'),
    ).toBeNull();

    // The address is taken after the service looked and before it inserts.
    const beforeInsert = new RaceGate();
    const restore = holdBefore(harness().admin, 'insertAccount', (call) =>
      call === 0 ? beforeInsert : undefined,
    );
    const late = refusalOf(create('late@example.test'));
    try {
      await beforeInsert.reached(1);
      await harness().seedAccount({
        email: 'late@example.test',
        name: 'First',
        role: DEFAULT_SLUG,
      });
    } finally {
      beforeInsert.release();
      restore();
    }

    expect(await late).toEqual(TAKEN);
    const winner = await harness().accountIdByEmail('late@example.test');
    expect((await storedAccount(harness(), winner ?? '')).name).toBe('First');
  });

  it('grants and takes back a permission of the account itself', async () => {
    const { userId, managerId } = fixture();
    const services = servicesOn(harness());

    const granted = await services.adminPermissions.addPermission(
      userId,
      READ_POSTS,
      managerId,
      MANAGER_SLUG,
    );
    expect(granted.data).toEqual({
      userId,
      permissions: [READ_USERS, READ_POSTS],
    });
    expect(
      await refusalOf(
        services.adminPermissions.addPermission(
          userId,
          READ_POSTS,
          managerId,
          MANAGER_SLUG,
        ),
      ),
    ).toEqual({ code: 'PERMISSION_ALREADY_EXISTS', status: 400 });

    const taken = await services.adminPermissions.removePermission(
      userId,
      READ_USERS,
      managerId,
      MANAGER_SLUG,
    );
    expect(taken.data).toEqual({ userId, permissions: [READ_POSTS] });
    expect(
      await refusalOf(
        services.adminPermissions.removePermission(
          userId,
          READ_USERS,
          managerId,
          MANAGER_SLUG,
        ),
      ),
    ).toEqual({ code: 'PERMISSION_NOT_FOUND', status: 404 });
    expect((await storedAccount(harness(), userId)).permissions).toEqual([
      READ_POSTS,
    ]);
    expect(
      (await services.adminPermissions.getUserPermissions(userId, MANAGER_SLUG))
        .data,
    ).toEqual({ userId, permissions: [READ_POSTS], role: DEFAULT_SLUG });
  });

  it('still reads the grants of a deactivated account, as the read never asked', async () => {
    const { userId } = fixture();
    await harness().alterAccount(userId, { deleted: true });
    const services = servicesOn(harness());

    const grants = await services.permissions.getUserPermissions(userId);

    expect(grants.data).toEqual({
      userId,
      permissions: [READ_USERS],
      role: DEFAULT_SLUG,
    });
    expect(
      await refusalOf(services.permissions.addPermission(userId, READ_POSTS)),
    ).toEqual({ code: 'USER_NOT_FOUND', status: 404 });
  });
}
