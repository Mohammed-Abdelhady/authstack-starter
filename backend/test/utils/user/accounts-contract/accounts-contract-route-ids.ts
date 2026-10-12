import { AppException } from '../../../../src/common/exceptions/app.exception';
import { MalformedIdError } from '../../../../src/common/persistence/persistence-errors';
import { RouteIdPipe } from '../../../../src/common/pipes/route-id.pipe';
import { ROUTE_ID_REFUSAL, routeIdAnswer } from '../../route-id-answers';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  READ_POSTS,
  READ_USERS,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

async function isMalformed(call: () => Promise<unknown>): Promise<boolean> {
  return (await rejectionOf(call())) instanceof MalformedIdError;
}

/** An account id as a route takes it and hands it to the admin area. */
export function accountRouteIdCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  const malformedIds = (): string[] => ['word', '', harness().foreignId()];

  it('lets through a route every id this database hands out', async () => {
    const { userId } = fixture();
    const stores = harness();
    const absent = stores.absentId();
    const pipe = new RouteIdPipe(stores.ids);
    const sessionId = await stores.seedSession(userId);

    expect([
      routeIdAnswer(pipe, userId),
      routeIdAnswer(pipe, sessionId),
      routeIdAnswer(pipe, absent),
    ]).toEqual([userId, sessionId, absent]);
  });

  it('refuses at a route the ids every committed read refuses as malformed', async () => {
    const stores = harness();
    const pipe = new RouteIdPipe(stores.ids);

    for (const id of malformedIds()) {
      const reads = {
        findAccount: () => stores.admin.findAccount(id),
        findAccountView: () => stores.admin.findAccountView(id),
        findGrants: () => stores.permissions.findGrants(id),
        findGrantedAccount: () => stores.permissions.findAccount(id),
      };
      const malformed: Record<string, boolean> = {};
      for (const [name, read] of Object.entries(reads)) {
        malformed[name] = await isMalformed(read);
      }

      expect({ route: routeIdAnswer(pipe, id), malformed }).toEqual({
        route: ROUTE_ID_REFUSAL,
        malformed: {
          findAccount: true,
          findAccountView: true,
          findGrants: true,
          findGrantedAccount: true,
        },
      });
    }
  });

  it('refuses a malformed id in every admin operation as malformed, never as a missing account', async () => {
    const { adminId, userId } = fixture();
    const services = servicesOn(harness());

    for (const id of malformedIds()) {
      const calls = {
        read: () => services.adminQueries.getUserById(id, ADMIN_SLUG),
        edit: () =>
          services.adminUsers.updateUser(
            id,
            { name: 'Renamed' },
            adminId,
            ADMIN_SLUG,
          ),
        resend: () =>
          services.adminUsers.resendEmailChange(id, adminId, ADMIN_SLUG),
        deactivate: () =>
          services.adminUsers.updateUserStatus(
            id,
            { isActive: false },
            adminId,
          ),
        changeRole: () =>
          services.adminUsers.updateUserRole(
            id,
            { role: DEFAULT_SLUG },
            adminId,
            ADMIN_SLUG,
          ),
        remove: () => services.adminUsers.deleteUser(id, adminId),
        readGrants: () =>
          services.adminPermissions.getUserPermissions(id, ADMIN_SLUG),
        grant: () =>
          services.adminPermissions.addPermission(
            id,
            READ_POSTS,
            adminId,
            ADMIN_SLUG,
          ),
        revoke: () =>
          services.adminPermissions.removePermission(
            id,
            READ_USERS,
            adminId,
            ADMIN_SLUG,
          ),
      };
      const malformed: Record<string, boolean> = {};
      for (const [name, call] of Object.entries(calls)) {
        malformed[name] = await isMalformed(call);
      }
      // Reactivation reads inside its unit of work, whose failure leaves as
      // the database raised it.
      const reactivated = await rejectionOf(
        services.adminUsers.updateUserStatus(id, { isActive: true }, adminId),
      );

      expect({
        malformed,
        reactivationAnsweredAsAnApplicationError:
          reactivated instanceof AppException,
      }).toEqual({
        malformed: {
          read: true,
          edit: true,
          resend: true,
          deactivate: true,
          changeRole: true,
          remove: true,
          readGrants: true,
          grant: true,
          revoke: true,
        },
        reactivationAnsweredAsAnApplicationError: false,
      });
    }
    expect(await storedAccount(harness(), userId)).toMatchObject({
      name: 'Plain Person',
      role: DEFAULT_SLUG,
      permissions: [READ_USERS],
      isDeleted: false,
      sessionVersion: 0,
    });
  });
}
