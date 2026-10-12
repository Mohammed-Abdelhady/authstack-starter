import * as bcrypt from 'bcrypt';
import {
  AccountsFixture,
  AccountsHarnessSource,
  DEFAULT_SLUG,
  NEW_PASSWORD,
  OLD_PASSWORD,
  passwordHash,
  READ_POSTS,
  READ_USERS,
  storedAccount,
  SUPPORT_SLUG,
} from './accounts-contract-support';

const PERSON = 'person@example.test';

/** What password sign-in, the reset and a request's permissions read. */
export function accountPasswordCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('finds the active account of an address for a password check, with its hash', async () => {
    const { userId } = fixture();

    const found = await harness().passwords.findForPasswordCheck(PERSON);

    expect({
      id: found?.account.id,
      email: found?.account.email,
      name: found?.account.name,
      role: found?.account.role,
      permissions: found?.account.permissions,
      authProvider: found?.account.authProvider,
      isVerified: found?.account.isVerified,
      isDeleted: found?.account.isDeleted,
      matchesOld: await bcrypt.compare(OLD_PASSWORD, found?.passwordHash ?? ''),
    }).toEqual({
      id: userId,
      email: PERSON,
      name: 'Plain Person',
      role: DEFAULT_SLUG,
      permissions: [READ_USERS],
      authProvider: 'email',
      isVerified: true,
      isDeleted: false,
      matchesOld: true,
    });
  });

  it('answers an account stored without a password with no hash', async () => {
    const { supportId } = fixture();

    const found = await harness().passwords.findForPasswordCheck(
      'support@example.test',
    );

    expect({ id: found?.account.id, hash: found?.passwordHash }).toEqual({
      id: supportId,
      hash: undefined,
    });
  });

  it('finds nothing for an unknown or an empty address', async () => {
    const { passwords } = harness();

    expect({
      unknownCheck: await passwords.findForPasswordCheck('nobody@example.test'),
      emptyCheck: await passwords.findForPasswordCheck(''),
      unknown: await passwords.findActiveByAddress('nobody@example.test'),
      empty: await passwords.findActiveByAddress(''),
    }).toEqual({
      unknownCheck: null,
      emptyCheck: null,
      unknown: null,
      empty: null,
    });
  });

  it('finds an address whatever its case and the space around it', async () => {
    const { userId } = fixture();
    const { passwords } = harness();

    expect({
      check: (await passwords.findForPasswordCheck('  Person@Example.TEST '))
        ?.account.id,
      plain: (await passwords.findActiveByAddress('PERSON@example.test'))?.id,
    }).toEqual({ check: userId, plain: userId });
  });

  it('never finds a deactivated account by its address', async () => {
    const { userId } = fixture();
    await harness().alterAccount(userId, { deleted: true });

    expect({
      check: await harness().passwords.findForPasswordCheck(PERSON),
      plain: await harness().passwords.findActiveByAddress(PERSON),
    }).toEqual({ check: null, plain: null });
  });

  it('finds the active account of an address without its hash', async () => {
    const { userId } = fixture();

    const found = await harness().passwords.findActiveByAddress(PERSON);

    expect({
      id: found?.id,
      name: found?.name,
      email: found?.email,
      carriesHash: JSON.stringify(found ?? {}).includes('$2'),
    }).toEqual({
      id: userId,
      name: 'Plain Person',
      email: PERSON,
      carriesHash: false,
    });
  });

  it('stores a new password on that account and leaves the rest as it was', async () => {
    const { userId, managerId } = fixture();
    const managerHash = await passwordHash('ManagerPassword1!');
    const newHash = await passwordHash(NEW_PASSWORD);
    const before = await storedAccount(harness(), userId);
    const account = await harness().passwords.findActiveByAddress(PERSON);
    if (!account) throw new Error('the account was not found');
    const manager = await harness().passwords.findActiveByAddress(
      'manager@example.test',
    );
    if (!manager) throw new Error('the manager was not found');
    await harness().passwords.storeNewPassword(manager, managerHash);

    await harness().passwords.storeNewPassword(account, newHash);

    const after = await storedAccount(harness(), userId);
    expect({
      hash: after.passwordHash,
      rest: { ...after, passwordHash: null },
      manager: (await storedAccount(harness(), managerId)).passwordHash,
    }).toEqual({
      hash: newHash,
      rest: { ...before, passwordHash: null },
      manager: managerHash,
    });
  });

  it('reads what a role grants by its slug', async () => {
    const { rolePermissions } = harness();

    expect({
      user: await rolePermissions.ofRole(DEFAULT_SLUG),
      none: await rolePermissions.ofRole(SUPPORT_SLUG),
      unknown: await rolePermissions.ofRole('no-such-role'),
      empty: await rolePermissions.ofRole(''),
    }).toEqual({
      user: [READ_POSTS],
      none: [],
      unknown: null,
      empty: null,
    });
  });
}
