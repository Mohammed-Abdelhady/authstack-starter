import {
  MalformedIdError,
  UniqueConflictError,
} from '../../../../src/common/persistence/persistence-errors';
import { UnitOfWork } from '../../../../src/common/persistence/unit-of-work';
import { rerunAtOnce } from '../../session/issuance-contract/issuance-contract-support';
import { rejectionOf } from '../../session/issuance-contract/issuance-contract-support';
import { StoredAccountEvent } from './accounts-contract-harness';
import {
  AccountsFixture,
  AccountsHarnessSource,
  DEFAULT_SLUG,
  storedAccount,
} from './accounts-contract-support';

const ADDRESS_RULE = 'user.email';
const SIGN_OUT_ACTIONS = ['sessions_revoked_all', 'sessions_revoked_others'];
const FAILED_AFTER_THE_EVENT = 'failed after the event was recorded';

/** What every adapter owes the seam, whatever the service above it does. */
export function accountSeamCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  const inWork = <Result>(
    work: (unitOfWork: UnitOfWork) => Promise<Result>,
  ): Promise<Result> => harness().runner(rerunAtOnce).run(work);

  // Seeding a session records its own event on one database.
  const signOutEvents = async (): Promise<StoredAccountEvent[]> =>
    (await harness().events()).filter((event) =>
      SIGN_OUT_ACTIONS.includes(event.action),
    );

  it('hands ids out and takes them back as the same strings', async () => {
    const { userId, managerId } = fixture();
    const stores = harness();

    const committed = await stores.admin.findAccount(userId);
    const taken = await inWork((work) =>
      stores.admin.takeAccountForChange(work, userId),
    );
    const own = await inWork((work) =>
      stores.profiles.readAccount(work, userId),
    );
    const listed = await stores.admin.listAccounts({
      viewableRoles: [DEFAULT_SLUG, 'manager'],
      page: 1,
      limit: 10,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    expect([committed?.id, taken?.id, own?.id]).toEqual([
      userId,
      userId,
      userId,
    ]);
    expect(listed.accounts.map((account) => account.id)).toEqual([
      managerId,
      userId,
    ]);
    expect((await stores.permissions.findGrants(userId))?.id).toBe(userId);
    expect((await stores.profiles.findPassword(userId))?.id).toBe(userId);
  });

  it('answers null for a well-formed id that names nothing', async () => {
    const stores = harness();
    const absent = stores.absentId();

    expect(await stores.admin.findAccount(absent)).toBeNull();
    expect(await stores.profiles.findProfile(absent)).toBeNull();
    expect(await stores.permissions.findGrants(absent)).toBeNull();
    expect(
      await inWork((work) => stores.admin.takeAccountForChange(work, absent)),
    ).toBeNull();
    expect(
      await inWork((work) => stores.sessions.revokeAll(work, absent)),
    ).toBe(0);
    expect(await stores.activation.isStored(absent)).toBe(false);
  });

  it('refuses a malformed id inside a unit of work', async () => {
    const stores = harness();

    for (const id of ['word', '', stores.foreignId()]) {
      const reads: Array<(work: UnitOfWork) => Promise<unknown>> = [
        (work) => stores.admin.readAccount(work, id),
        (work) => stores.admin.takeAccountForChange(work, id),
        (work) => stores.profiles.readAccount(work, id),
        (work) => stores.profiles.countOtherActiveAdmins(work, id),
        (work) => stores.activation.readMovedAccount(work, id),
        (work) => stores.sessions.revokeAll(work, id),
        (work) => stores.sessions.revokeAllExcept(work, id, stores.absentId()),
      ];
      for (const read of reads) {
        expect(await rejectionOf(inWork(read))).toBeInstanceOf(
          MalformedIdError,
        );
      }
    }
  });

  it('keeps the active address unique and stores admin moves as pending', async () => {
    const { userId } = fixture();
    const stores = harness();

    const inserted = await rejectionOf(
      inWork((work) =>
        stores.admin.insertAccount(work, {
          email: 'Person@Example.Test',
          name: 'Second',
          passwordHash: 'hash',
          role: DEFAULT_SLUG,
          locale: 'en',
        }),
      ),
    );
    const moved = await inWork(async (work) => {
      const account = await stores.admin.takeAccountForChange(work, userId);
      if (!account) throw new Error('the account is not stored');
      return stores.admin.saveIdentity(work, account, {
        address: {
          email: 'manager@example.test',
          addressGeneration: 1,
        },
      });
    });
    const activated = await rejectionOf(
      inWork((work) =>
        stores.activation.insertActivated(work, {
          audience: undefined,
          id: stores.activation.newAccountId(),
          email: 'person@example.test',
          passwordHash: 'hash',
          name: 'Third',
          locale: 'en',
        }),
      ),
    );

    for (const refused of [inserted, activated]) {
      expect(refused).toBeInstanceOf(UniqueConflictError);
      expect(refused).toMatchObject({ constraint: ADDRESS_RULE });
    }
    expect(moved).toMatchObject({
      email: 'person@example.test',
      pendingEmail: 'manager@example.test',
      addressGeneration: 1,
    });
    expect(await storedAccount(stores, userId)).toMatchObject({
      email: 'person@example.test',
      pendingEmail: 'manager@example.test',
      addressGeneration: 1,
    });
  });

  it('stores an address trimmed and in lower case, and finds it by either form', async () => {
    const stores = harness();

    const created = await inWork((work) =>
      stores.admin.insertAccount(work, {
        email: '  Mixed.Case@Example.Test ',
        name: 'Mixed',
        passwordHash: 'hash',
        role: DEFAULT_SLUG,
        locale: 'en',
      }),
    );

    expect(created.email).toBe('mixed.case@example.test');
    expect(await stores.admin.isAddressTaken('MIXED.case@example.test')).toBe(
      true,
    );
    expect(await stores.admin.isAddressTaken(' mixed.case@example.test ')).toBe(
      true,
    );
    expect(
      await stores.activation.findAddressOwner('Mixed.Case@Example.Test'),
    ).toEqual({ name: 'Mixed', isDeleted: false, locale: 'en' });
    expect(await stores.admin.isAddressTaken('nobody@example.test')).toBe(
      false,
    );
  });

  it('removes a created account only while it is as it was created', async () => {
    const stores = harness();
    const created = await inWork((work) =>
      stores.admin.insertAccount(work, {
        email: 'created@example.test',
        name: 'Created',
        passwordHash: 'hash',
        role: DEFAULT_SLUG,
        locale: 'en',
      }),
    );
    const mark = {
      id: created.id,
      role: created.role,
      updatedAt: created.updatedAt,
      sessionVersion: created.sessionVersion,
    };

    await inWork((work) =>
      stores.admin.removeCreatedAccount(work, { ...mark, sessionVersion: 1 }),
    );
    await inWork((work) =>
      stores.admin.removeCreatedAccount(work, { ...mark, role: 'manager' }),
    );
    expect(await stores.account(created.id)).not.toBeNull();

    await inWork((work) => stores.admin.removeCreatedAccount(work, mark));
    expect(await stores.account(created.id)).toBeNull();
  });

  it('keeps one session and reports how many it ended', async () => {
    const { userId } = fixture();
    const stores = harness();
    const kept = await stores.seedSession(userId);
    await stores.seedSession(userId);
    await stores.seedSession(userId);

    const ended = await inWork((work) =>
      stores.sessions.revokeAllExcept(work, userId, kept),
    );

    expect(ended).toBe(2);
    expect(await stores.liveSessionIds(userId)).toEqual([kept]);
    expect(
      await inWork((work) => stores.sessions.revokeAll(work, userId)),
    ).toBe(1);
    expect(await stores.liveSessionIds(userId)).toEqual([]);
    expect((await storedAccount(stores, userId)).sessionVersion).toBe(2);
  });

  it('names the kept session on the sign-out event', async () => {
    const { userId } = fixture();
    const stores = harness();
    const kept = await stores.seedSession(userId);
    await stores.seedSession(userId);

    await inWork((work) => stores.sessions.revokeAllExcept(work, userId, kept));

    expect(await signOutEvents()).toEqual([
      {
        targetUserId: userId,
        actorId: null,
        sessionId: kept,
        action: 'sessions_revoked_others',
        reasonCode: 'all_other',
        assignedRoleId: null,
        previousRoleId: null,
        assignmentSessionVersion: null,
      },
    ]);
  });

  it('stores no sign-out event when the work fails after recording it', async () => {
    const { userId } = fixture();
    const stores = harness();
    const kept = await stores.seedSession(userId);
    const failure = new Error(FAILED_AFTER_THE_EVENT);

    const afterAll = await rejectionOf(
      inWork(async (work) => {
        await stores.sessions.revokeAll(work, userId);
        throw failure;
      }),
    );
    const afterOthers = await rejectionOf(
      inWork(async (work) => {
        await stores.sessions.revokeAllExcept(work, userId, kept);
        throw failure;
      }),
    );

    expect([afterAll, afterOthers]).toEqual([failure, failure]);
    expect(await signOutEvents()).toEqual([]);
    expect(await stores.liveSessionIds(userId)).toEqual([kept]);
    expect((await storedAccount(stores, userId)).sessionVersion).toBe(0);
  });
}
