import { USER_PERMISSIONS } from '../../../../src/common/constants/permissions';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  refusalOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const CHIEF_SLUG = 'content-chief';
const STRANDED_SLUG = 'retired-role';
const NOT_ADMIN = { code: 'EMAIL_CHANGE_NOT_ALLOWED', status: 403 };
const HIGHER_ROLE = { code: 'CANNOT_MODIFY_HIGHER_ROLE', status: 403 };

/**
 * Admin-only actions follow the stored admin role, not a level. The admin role
 * sits at 6, as a reseed leaves it after a host role at 5 was dropped, and a
 * custom role at 6 holds what the admin services ask for.
 */
export function accountAdminRoleCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  async function seedChief(): Promise<string> {
    await harness().removeRole(ADMIN_SLUG);
    await harness().seedRole({
      name: 'Admin',
      slug: ADMIN_SLUG,
      level: 6,
      permissions: ['*'],
    });
    await harness().seedRole({
      name: 'Content Chief',
      slug: CHIEF_SLUG,
      level: 6,
      permissions: [USER_PERMISSIONS.UPDATE_ALL, USER_PERMISSIONS.READ_ALL],
    });
    return harness().seedAccount({
      email: 'chief@example.test',
      role: CHIEF_SLUG,
    });
  }

  it('refuses an address change by a custom role at the admin level', async () => {
    const chiefId = await seedChief();

    const refusal = await refusalOf(
      servicesOn(harness()).adminUsers.updateUser(
        fixture().userId,
        { email: 'moved@example.test' },
        chiefId,
        CHIEF_SLUG,
      ),
    );

    expect({
      refusal,
      pending: (await storedAccount(harness(), fixture().userId)).pendingEmail,
    }).toEqual({ refusal: NOT_ADMIN, pending: null });
  });

  it('refuses a confirmation resend by a custom role at the admin level', async () => {
    const chiefId = await seedChief();
    const waitingId = await harness().seedAccount({
      email: 'waiting@example.test',
      pendingEmail: 'next@example.test',
      role: DEFAULT_SLUG,
    });

    const services = servicesOn(harness());
    const refusal = await refusalOf(
      services.adminUsers.resendEmailChange(waitingId, chiefId, CHIEF_SLUG),
    );

    expect({ refusal, mail: services.mail.length }).toEqual({
      refusal: NOT_ADMIN,
      mail: 0,
    });
  });

  it('leaves an account on a role that no longer exists to the admin role', async () => {
    const chiefId = await seedChief();
    const strandedId = await harness().seedAccount({
      email: 'stranded@example.test',
      name: 'Stranded',
      role: STRANDED_SLUG,
    });
    const services = servicesOn(harness());

    const chief = await refusalOf(
      services.adminUsers.updateUser(
        strandedId,
        { name: 'Renamed by chief' },
        chiefId,
        CHIEF_SLUG,
      ),
    );
    await services.adminUsers.updateUser(
      strandedId,
      { name: 'Renamed by admin' },
      fixture().adminId,
      ADMIN_SLUG,
    );

    expect({
      chief,
      name: (await storedAccount(harness(), strandedId)).name,
    }).toEqual({ chief: HIGHER_ROLE, name: 'Renamed by admin' });
  });
}
