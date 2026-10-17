import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_FORCED,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  MANAGER_SLUG,
  refusalOf,
  REVOKED_ALL,
  revocationsOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const HIGHER_ROLE = { code: 'CANNOT_MODIFY_HIGHER_ROLE', status: 403 };

/** What an admin reads and changes on another account. */
export function accountAdminCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('lists newest first, only roles the actor may see', async () => {
    const services = servicesOn(harness());

    const firstPage = await services.adminQueries.listUsers(
      { page: 1, limit: 2 },
      MANAGER_SLUG,
    );
    const lastPage = await services.adminQueries.listUsers(
      { page: 2, limit: 2 },
      MANAGER_SLUG,
    );
    const beyond = await services.adminQueries.listUsers(
      { page: 3, limit: 2 },
      MANAGER_SLUG,
    );

    expect(firstPage.data?.data.map((user) => user.email)).toEqual([
      'person@example.test',
      'support@example.test',
    ]);
    expect(firstPage.data?.pagination).toEqual({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(lastPage.data?.data.map((user) => user.email)).toEqual([
      'manager@example.test',
    ]);
    expect(beyond.data?.data).toEqual([]);
    expect(firstPage.data?.data[0].id).toBe(fixture().userId);
  });

  it('searches name and address literally, ignoring case', async () => {
    await harness().seedAccount({
      email: 'odd@example.test',
      name: '100%_done',
      role: DEFAULT_SLUG,
    });
    const services = servicesOn(harness());
    const found = async (search: string): Promise<string[]> => {
      const page = await services.adminQueries.listUsers(
        { page: 1, limit: 10, search },
        ADMIN_SLUG,
      );
      return (page.data?.data ?? []).map((user) => user.email).sort();
    };

    expect(await found('%')).toEqual(['odd@example.test']);
    expect(await found('0%_D')).toEqual(['odd@example.test']);
    expect(await found('PLAIN per')).toEqual(['person@example.test']);
    expect(await found('SECOND-ADMIN@')).toEqual(['second-admin@example.test']);
    expect(await found('.*')).toEqual([]);
  });

  it('filters by status and by role', async () => {
    const { userId, supportId } = fixture();
    await harness().alterAccount(supportId, { deleted: true });
    const services = servicesOn(harness());
    const listed = async (query: {
      status?: 'active' | 'deleted';
      role?: string;
    }): Promise<string[]> => {
      const page = await services.adminQueries.listUsers(
        { page: 1, limit: 10, ...query },
        MANAGER_SLUG,
      );
      return (page.data?.data ?? []).map((user) => user.id);
    };

    expect(await listed({ status: 'deleted' })).toEqual([supportId]);
    expect(await listed({ role: DEFAULT_SLUG })).toEqual([userId]);
    // A role above the actor is not a filter the actor can reach.
    expect(await listed({ role: ADMIN_SLUG, status: 'active' })).toEqual([
      userId,
      fixture().managerId,
    ]);
  });

  it('shows a peer and hides an account above the actor', async () => {
    const { managerId, adminId, userId } = fixture();
    await harness().alterAccount(userId, { deleted: true });
    const services = servicesOn(harness());

    const peer = await services.adminQueries.getUserById(
      managerId,
      MANAGER_SLUG,
    );

    expect(peer.data).toMatchObject({
      id: managerId,
      email: 'manager@example.test',
      role: MANAGER_SLUG,
    });
    expect(
      await refusalOf(services.adminQueries.getUserById(adminId, MANAGER_SLUG)),
    ).toEqual(HIGHER_ROLE);
    expect(
      await refusalOf(services.adminQueries.getUserById(userId, ADMIN_SLUG)),
    ).toEqual({ code: 'USER_NOT_FOUND', status: 404 });
  });

  it('deactivates an account and signs it out', async () => {
    const { userId, managerId } = fixture();
    await harness().seedSession(userId);

    const answer = await servicesOn(harness()).adminUsers.updateUserStatus(
      userId,
      { isActive: false },
      managerId,
    );

    expect(answer.data).toMatchObject({ id: userId, isDeleted: true });
    const stored = await storedAccount(harness(), userId);
    expect(stored.isDeleted).toBe(true);
    expect(stored.deletedAt).toBeInstanceOf(Date);
    expect(stored.sessionVersion).toBe(1);
    expect(await harness().liveSessionIds(userId)).toEqual([]);
    // The status change is the staff record; its sign-out names no actor.
    expect(await revocationsOf(harness())).toEqual([
      `${REVOKED_ALL} of ${userId} by nobody (${ADMIN_FORCED})`,
    ]);
  });

  it('brings a deactivated account back without a sign-out', async () => {
    const { userId, managerId } = fixture();
    const services = servicesOn(harness());
    await services.adminUsers.updateUserStatus(
      userId,
      { isActive: false },
      managerId,
    );

    const answer = await services.adminUsers.updateUserStatus(
      userId,
      { isActive: true },
      managerId,
    );

    expect(answer.data).toMatchObject({ id: userId, isDeleted: false });
    expect(await storedAccount(harness(), userId)).toMatchObject({
      isDeleted: false,
      deletedAt: null,
      // Still the one sign-out the deactivation caused.
      sessionVersion: 1,
    });
    expect(await revocationsOf(harness())).toHaveLength(1);
    expect((await services.profile.getProfile(userId)).data?.id).toBe(userId);
  });

  it('soft deletes an account once', async () => {
    const { userId, managerId } = fixture();
    const services = servicesOn(harness());

    await services.adminUsers.deleteUser(userId, managerId);

    expect(await storedAccount(harness(), userId)).toMatchObject({
      isDeleted: true,
      sessionVersion: 1,
    });
    expect(
      await refusalOf(services.adminUsers.deleteUser(userId, managerId)),
    ).toEqual({ code: 'USER_ALREADY_DELETED', status: 400 });
    expect(
      await refusalOf(services.adminUsers.deleteUser(managerId, managerId)),
    ).toEqual({ code: 'CANNOT_MODIFY_SELF', status: 400 });
    expect(await revocationsOf(harness())).toHaveLength(1);
  });

  it('assigns a role and records what it replaced', async () => {
    const { userId, managerId, editorRoleId, defaultRoleId } = fixture();
    await harness().seedSession(userId);

    const services = servicesOn(harness());
    const answer = await services.adminUsers.updateUserRole(
      userId,
      { role: EDITOR_SLUG },
      managerId,
      MANAGER_SLUG,
    );

    expect(answer.data).toEqual({ id: userId, role: EDITOR_SLUG, version: 1 });
    expect(await storedAccount(harness(), userId)).toMatchObject({
      role: EDITOR_SLUG,
      sessionVersion: 1,
    });
    expect(await harness().liveSessionIds(userId)).toEqual([]);
    const listed = await services.adminQueries.listUsers(
      { role: EDITOR_SLUG, page: 1, limit: 10 },
      MANAGER_SLUG,
    );
    expect(listed.data?.data.map((account) => account.id)).toEqual([userId]);
    expect(
      (await services.adminQueries.getUserById(userId, MANAGER_SLUG)).data,
    ).toMatchObject({ id: userId, role: 'content-editor' });
    const signOuts = (await harness().events()).filter(
      (event) => event.action === REVOKED_ALL,
    );
    expect(signOuts).toEqual([
      {
        targetUserId: userId,
        actorId: managerId,
        sessionId: null,
        action: REVOKED_ALL,
        reasonCode: ADMIN_FORCED,
        assignedRoleId: editorRoleId,
        previousRoleId: defaultRoleId,
        assignmentSessionVersion: 1,
      },
    ]);
  });

  it('refuses a role that is unknown, admin, or at the actor level', async () => {
    const { userId, managerId } = fixture();
    const services = servicesOn(harness());
    const assign = (role: string): Promise<unknown> =>
      services.adminUsers.updateUserRole(
        userId,
        { role },
        managerId,
        MANAGER_SLUG,
      );

    expect(await refusalOf(assign('ghost-role'))).toEqual({
      code: 'ROLE_NOT_FOUND',
      status: 404,
    });
    expect(await refusalOf(assign(ADMIN_SLUG))).toEqual({
      code: 'INVALID_ROLE_ASSIGNMENT',
      status: 400,
    });
    expect(await refusalOf(assign(MANAGER_SLUG))).toEqual(HIGHER_ROLE);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      role: DEFAULT_SLUG,
      sessionVersion: 0,
    });
  });

  it('renames an account and leaves its address alone', async () => {
    const { userId, managerId } = fixture();

    const services = servicesOn(harness());
    const answer = await services.adminUsers.updateUser(
      userId,
      { name: '  Renamed By Admin ' },
      managerId,
      MANAGER_SLUG,
    );

    expect(answer.data).toMatchObject({ id: userId, name: 'Renamed By Admin' });
    expect(await storedAccount(harness(), userId)).toMatchObject({
      name: 'Renamed By Admin',
      email: 'person@example.test',
      isVerified: true,
      addressGeneration: 0,
      sessionVersion: 0,
    });
    expect(services.mail).toEqual([]);
  });
}
