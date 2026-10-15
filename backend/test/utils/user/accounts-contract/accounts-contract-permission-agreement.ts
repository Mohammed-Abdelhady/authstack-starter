import { ConfigService } from '@nestjs/config';
import { browserApplicationsForTest } from '../../../../src/common/testing/browser-applications.harness-spec';
import { WEB_CLIENT_ID } from '../../../../src/session/constants/client-ids';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  AuthGuard,
  RequestWithUser,
} from '../../../../src/auth/guards/auth.guard';
import { SessionCookieService } from '../../../../src/auth/services/sessions/session-cookie.service';
import { Sessions } from '../../../../src/auth/services/sessions/sessions';
import * as permissionRules from '../../../../src/auth/utils/permissions.util';
import { createExecutionContextMock } from '../../../../src/common/testing/test-doubles.harness-spec';
import { RolePermissions } from '../../../../src/role/stores/role-permissions';
import { NativeAccessService } from '../../../../src/session/native/access/native-access.service';
import { AccountsContractHarness } from './accounts-contract-harness';
import {
  AccountsFixture,
  AccountsHarnessSource,
  READ_POSTS,
  READ_USERS,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const WILDCARD = '*';
const GHOST_SLUG = 'ghost';

class GuardedRoute {
  handle(this: void): void {}
}

/**
 * The real guard resolves permissions using the stored account and role.
 * Only the session validator is replaced; cookies use the real resolver.
 */
async function guardPermissions(
  harness: AccountsContractHarness,
  userId: string,
): Promise<string[] | undefined> {
  const stored = await storedAccount(harness, userId);
  const config = new ConfigService({ session: { cookieName: 'sid' } });
  const cookie = new SessionCookieService(
    config,
    browserApplicationsForTest(config),
  );
  const session = {
    clientId: WEB_CLIENT_ID,
    user: {
      id: userId,
      email: stored.email,
      name: stored.name,
      role: stored.role,
      permissions: stored.permissions,
      isVerified: stored.isVerified,
      isDeleted: stored.isDeleted,
    },
  };
  const module = await Test.createTestingModule({
    providers: [
      AuthGuard,
      Reflector,
      {
        provide: Sessions,
        useValue: { validateSession: () => Promise.resolve(session) },
      },
      {
        provide: SessionCookieService,
        useValue: cookie,
      },
      { provide: NativeAccessService, useValue: {} },
      { provide: RolePermissions, useValue: harness.rolePermissions },
    ],
  }).compile();
  const request: Partial<RequestWithUser> = {
    headers: {},
    cookies: { sid: 'a-session-token' },
  };
  const context = createExecutionContextMock({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => GuardedRoute.prototype.handle,
    getClass: () => GuardedRoute,
  });
  await module.get(AuthGuard).canActivate(context);
  return request.user?.permissions;
}

/** The profile and the guard tell an account the same permissions. */
export function accountPermissionAgreementCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  const profilePermissions = async (userId: string): Promise<string[]> =>
    (await servicesOn(harness()).profile.getProfile(userId)).data
      ?.permissions ?? [];
  const both = async (userId: string) => ({
    guard: await guardPermissions(harness(), userId),
    profile: await profilePermissions(userId),
  });

  it('tells an account the same permissions in its profile as the guard tells a request', async () => {
    const { userId, adminId, supportId } = fixture();
    await harness().alterAccount(supportId, { role: GHOST_SLUG });
    const noRole = await harness().seedAccount({
      email: 'no-role-of-that-slug@example.test',
      role: GHOST_SLUG,
      permissions: [READ_USERS, READ_USERS],
    });

    expect({
      roleAndOwn: await both(userId),
      wildcardRole: await both(adminId),
      slugNoRoleCarries: await both(supportId),
      ownOnly: await both(noRole),
    }).toEqual({
      roleAndOwn: {
        guard: [READ_POSTS, READ_USERS],
        profile: [READ_POSTS, READ_USERS],
      },
      wildcardRole: { guard: [WILDCARD], profile: [WILDCARD] },
      slugNoRoleCarries: { guard: [], profile: [] },
      ownOnly: { guard: [READ_USERS], profile: [READ_USERS] },
    });
  });

  it('applies a rule added to the shared resolution to the profile and the guard alike', async () => {
    const { userId } = fixture();
    jest
      .spyOn(permissionRules, 'effectivePermissions')
      .mockImplementation((ofRole, own) =>
        [...(ofRole ?? []), ...(own ?? [])].filter(
          (permission) => permission !== READ_USERS,
        ),
      );

    expect(await both(userId)).toEqual({
      guard: [READ_POSTS],
      profile: [READ_POSTS],
    });
  });

  it('reads the role for the profile through the adapter the guard reads it through', async () => {
    const { userId } = fixture();
    const adapter: unknown = Object.getPrototypeOf(harness().rolePermissions);
    if (!(adapter instanceof RolePermissions)) {
      throw new Error('the harness holds no role permissions adapter');
    }
    jest.spyOn(adapter, 'ofRole').mockResolvedValue([WILDCARD]);

    expect(await both(userId)).toEqual({
      guard: [WILDCARD, READ_USERS],
      profile: [WILDCARD, READ_USERS],
    });
  });
}
