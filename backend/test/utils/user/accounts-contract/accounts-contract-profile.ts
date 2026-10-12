import * as bcrypt from 'bcrypt';
import { RaceGate } from '../../race-gate';
import {
  holdReruns,
  rerunAtOnce,
} from '../../session/issuance-contract/issuance-contract-support';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ALL_OTHER,
  NEW_PASSWORD,
  OLD_PASSWORD,
  READ_POSTS,
  READ_USERS,
  refusalOf,
  REVOKED_OTHERS,
  revocationsOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const NOT_FOUND = { code: 'USER_NOT_FOUND', status: 404 };
const INVALID_INPUT = { code: 'INVALID_INPUT', status: 400 };

/** A person's own profile, name and password. */
export function accountProfileCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('reads a profile under the id it was stored with', async () => {
    const { userId } = fixture();

    const profile = await servicesOn(harness()).profile.getProfile(userId);

    expect(profile.data).toMatchObject({
      id: userId,
      email: 'person@example.test',
      name: 'Plain Person',
      role: 'user',
      authProvider: 'email',
      isVerified: true,
      linkedProviders: ['email'],
    });
    // The role's permission and the account's own, each once.
    expect([...(profile.data?.permissions ?? [])].sort()).toEqual([
      READ_POSTS,
      READ_USERS,
    ]);
  });

  it('answers not found for an id nobody has', async () => {
    const services = servicesOn(harness());

    expect(
      await refusalOf(services.profile.getProfile(harness().absentId())),
    ).toEqual(NOT_FOUND);
  });

  it('refuses an id this database could not have issued', async () => {
    const services = servicesOn(harness());

    for (const id of ['word', '', harness().foreignId()]) {
      expect(await refusalOf(services.profile.getProfile(id))).toEqual(
        INVALID_INPUT,
      );
      expect(
        await refusalOf(services.profile.updateProfile(id, { name: 'X' })),
      ).toEqual(INVALID_INPUT);
    }
  });

  it('hides a deactivated account from its own profile', async () => {
    const { userId } = fixture();
    await harness().alterAccount(userId, { deleted: true });
    const services = servicesOn(harness());

    expect(await refusalOf(services.profile.getProfile(userId))).toEqual(
      NOT_FOUND,
    );
    expect(
      await refusalOf(services.profile.updateProfile(userId, { name: 'New' })),
    ).toEqual(NOT_FOUND);
    expect((await storedAccount(harness(), userId)).name).toBe('Plain Person');
  });

  it('stores a new name without its outer spaces', async () => {
    const { userId } = fixture();

    const updated = await servicesOn(harness()).profile.updateProfile(userId, {
      name: '  Renamed Person  ',
    });

    expect(updated.data?.name).toBe('Renamed Person');
    expect((await storedAccount(harness(), userId)).name).toBe(
      'Renamed Person',
    );
  });

  it('changes the password and keeps only the calling session', async () => {
    const { userId } = fixture();
    const kept = await harness().seedSession(userId);
    await harness().seedSession(userId);

    await servicesOn(harness()).profile.changePassword(
      userId,
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      kept,
    );

    const stored = await storedAccount(harness(), userId);
    expect(await bcrypt.compare(NEW_PASSWORD, stored.passwordHash ?? '')).toBe(
      true,
    );
    expect(stored.sessionVersion).toBe(1);
    expect(await harness().liveSessionIds(userId)).toEqual([kept]);
    expect(await revocationsOf(harness())).toEqual([
      `${REVOKED_OTHERS} of ${userId} by nobody (${ALL_OTHER})`,
    ]);
  });

  it('refuses a wrong, an unchanged and a missing password', async () => {
    const { userId, managerId } = fixture();
    const kept = await harness().seedSession(userId);
    const services = servicesOn(harness());

    expect(
      await refusalOf(
        services.profile.changePassword(
          userId,
          { currentPassword: 'Wrong123!', newPassword: NEW_PASSWORD },
          kept,
        ),
      ),
    ).toEqual({ code: 'INVALID_CURRENT_PASSWORD', status: 400 });
    expect(
      await refusalOf(
        services.profile.changePassword(
          userId,
          { currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD },
          kept,
        ),
      ),
    ).toEqual({ code: 'SAME_PASSWORD', status: 400 });
    // The manager was stored without a password.
    expect(
      await refusalOf(
        services.profile.changePassword(
          managerId,
          { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
          await harness().seedSession(managerId),
        ),
      ),
    ).toEqual({ code: 'INVALID_CURRENT_PASSWORD', status: 400 });
    const stored = await storedAccount(harness(), userId);
    expect(await bcrypt.compare(OLD_PASSWORD, stored.passwordHash ?? '')).toBe(
      true,
    );
    expect(stored.sessionVersion).toBe(0);
  });

  it('leaves the old password when the session to keep is not live', async () => {
    const { userId, managerId } = fixture();
    const anotherAccounts = await harness().seedSession(managerId);
    const services = servicesOn(harness());

    for (const kept of [anotherAccounts, harness().absentId(), 'word']) {
      expect(
        await refusalOf(
          services.profile.changePassword(
            userId,
            { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
            kept,
          ),
        ),
      ).toEqual({ code: 'SESSION_INVALID', status: 401 });
    }
    expect(
      await refusalOf(
        services.profile.changePassword(
          userId,
          { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
          null,
        ),
      ),
    ).toEqual({ code: 'SESSION_INVALID', status: 401 });

    const stored = await storedAccount(harness(), userId);
    expect(await bcrypt.compare(OLD_PASSWORD, stored.passwordHash ?? '')).toBe(
      true,
    );
    expect(stored.sessionVersion).toBe(0);
    expect(await revocationsOf(harness())).toEqual([]);
  });

  it('stores the new password on the attempt that runs after a refused one', async () => {
    const { userId } = fixture();
    const kept = await harness().seedSession(userId);
    const reruns = holdReruns();
    const services = servicesOn(harness(), reruns.pause);
    // Another unit of work writes the account and stays open.
    const open = new RaceGate();
    const other = harness()
      .runner(rerunAtOnce)
      .run(async (unitOfWork) => {
        const account = await harness().profiles.readAccount(
          unitOfWork,
          userId,
        );
        if (!account) throw new Error('the account is not stored');
        await harness().profiles.savePasswordHash(
          unitOfWork,
          account,
          'hash-of-the-other-writer',
        );
        await open.hold();
      });
    await open.reached(1);

    const change = services.profile.changePassword(
      userId,
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      kept,
    );
    try {
      // The change was refused while the other writer held the account.
      await reruns.refused.reached(1);
    } finally {
      open.release();
      await other;
      reruns.refused.release();
    }
    await change;

    expect(reruns.calls).toEqual([1]);
    const stored = await storedAccount(harness(), userId);
    expect(await bcrypt.compare(NEW_PASSWORD, stored.passwordHash ?? '')).toBe(
      true,
    );
    expect(await harness().liveSessionIds(userId)).toEqual([kept]);
  });
}
