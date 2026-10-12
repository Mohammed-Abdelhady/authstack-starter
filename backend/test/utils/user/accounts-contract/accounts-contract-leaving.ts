import { holdBefore, RaceGate } from '../../race-gate';
import { holdReruns } from '../../session/issuance-contract/issuance-contract-support';
import { TEST_NOW } from '../../frozen-clock';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  ALL_USER,
  answerOf,
  refusalOf,
  REVOKED_ALL,
  revocationsOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const LAST_ADMIN = { code: 'ADMIN_CANNOT_DEACTIVATE_SELF', status: 403 };

async function activeAdmins(
  harness: AccountsHarnessSource,
  adminIds: string[],
): Promise<number> {
  let active = 0;
  for (const adminId of adminIds) {
    if (!(await storedAccount(harness(), adminId)).isDeleted) active += 1;
  }
  return active;
}

function outcomeOf(result: PromiseSettledResult<unknown>): unknown {
  return result.status === 'fulfilled' ? 'left' : answerOf(result.reason);
}

/** A person deactivating their own account, and the last admin who may not. */
export function accountLeavingCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('deactivates an account and ends its sessions', async () => {
    const { userId } = fixture();
    await harness().seedSession(userId);

    await servicesOn(harness()).profile.deactivateAccount(userId);

    expect(await storedAccount(harness(), userId)).toMatchObject({
      isDeleted: true,
      deletedAt: TEST_NOW,
      sessionVersion: 1,
    });
    expect(await harness().liveSessionIds(userId)).toEqual([]);
    expect(await revocationsOf(harness())).toEqual([
      `${REVOKED_ALL} of ${userId} by nobody (${ALL_USER})`,
    ]);
  });

  it('answers not found for an account already gone', async () => {
    const { userId } = fixture();
    await harness().alterAccount(userId, { deleted: true });
    const services = servicesOn(harness());

    expect(await refusalOf(services.profile.deactivateAccount(userId))).toEqual(
      { code: 'USER_NOT_FOUND', status: 404 },
    );
    expect(
      await refusalOf(services.profile.deactivateAccount(harness().absentId())),
    ).toEqual({ code: 'USER_NOT_FOUND', status: 404 });
    expect((await storedAccount(harness(), userId)).sessionVersion).toBe(0);
  });

  it('lets one of two admins leave and refuses the last', async () => {
    const { adminId, secondAdminId } = fixture();
    const kept = await harness().seedSession(secondAdminId);
    const services = servicesOn(harness());

    await services.profile.deactivateAccount(adminId);

    expect(
      await refusalOf(services.profile.deactivateAccount(secondAdminId)),
    ).toEqual(LAST_ADMIN);
    expect(await storedAccount(harness(), secondAdminId)).toMatchObject({
      isDeleted: false,
      deletedAt: null,
      sessionVersion: 0,
    });
    expect(await harness().liveSessionIds(secondAdminId)).toEqual([kept]);
  });

  it('does not count a deactivated admin as one who remains', async () => {
    const { adminId, secondAdminId } = fixture();
    await harness().alterAccount(secondAdminId, { deleted: true });

    expect(
      await refusalOf(servicesOn(harness()).profile.deactivateAccount(adminId)),
    ).toEqual(LAST_ADMIN);
    expect((await storedAccount(harness(), adminId)).isDeleted).toBe(false);
  });

  it('refuses an admin when no admin role is stored', async () => {
    const { adminId } = fixture();
    await harness().removeRole(ADMIN_SLUG);

    expect(
      await refusalOf(servicesOn(harness()).profile.deactivateAccount(adminId)),
    ).toEqual({ code: 'AUTHORITY_UNAVAILABLE', status: 503 });
    expect((await storedAccount(harness(), adminId)).isDeleted).toBe(false);
  });

  it('keeps the account and its sessions when the sign-out cannot be recorded', async () => {
    const { userId } = fixture();
    const session = await harness().seedSession(userId);
    const restore = await harness().refuseSecurityEvents();
    let rejected = false;
    try {
      await servicesOn(harness())
        .profile.deactivateAccount(userId)
        .catch(() => {
          rejected = true;
        });
    } finally {
      restore();
    }

    expect(rejected).toBe(true);
    expect(await storedAccount(harness(), userId)).toMatchObject({
      isDeleted: false,
      deletedAt: null,
      sessionVersion: 0,
    });
    expect(await harness().liveSessionIds(userId)).toEqual([session]);
  });

  it('leaves one admin when two leave at the same time', async () => {
    const { adminId, secondAdminId } = fixture();
    const reruns = holdReruns();
    const services = servicesOn(harness(), reruns.pause);
    const atFence = new RaceGate();
    const restore = holdBefore(
      harness().profiles,
      'fenceAdminRole',
      () => atFence,
    );
    const first = services.profile.deactivateAccount(adminId);
    const second = services.profile.deactivateAccount(secondAdminId);
    const both = Promise.allSettled([first, second]);
    try {
      // Both counted the other, or one was refused while the other held the fence.
      await Promise.race([atFence.reached(2), reruns.refused.reached(1)]);
      atFence.release();
      // One of them finishes before the refused one may run again.
      await Promise.race([first, second]).catch(() => undefined);
    } finally {
      atFence.release();
      reruns.refused.release();
      restore();
    }

    const outcomes = (await both).map(outcomeOf);
    expect(outcomes).toContain('left');
    expect(outcomes).toContainEqual(LAST_ADMIN);
    expect(await activeAdmins(harness, [adminId, secondAdminId])).toBe(1);
  });

  it('counts again when the other admin left after the count', async () => {
    const { adminId, secondAdminId } = fixture();
    const reruns = holdReruns();
    const services = servicesOn(harness(), reruns.pause);
    const counted = new RaceGate();
    const restore = holdBefore(harness().profiles, 'fenceAdminRole', (call) =>
      call === 0 ? counted : undefined,
    );
    // The first admin has counted the second one and not passed the fence.
    const first = services.profile.deactivateAccount(adminId);
    await counted.reached(1);
    const second = services.profile.deactivateAccount(secondAdminId);
    const both = Promise.allSettled([first, second]);
    try {
      // The second one left, or was refused because the first holds the fence.
      await Promise.race([
        second.catch(() => undefined),
        reruns.refused.reached(1),
      ]);
      counted.release();
      await Promise.race([first, second]).catch(() => undefined);
    } finally {
      counted.release();
      reruns.refused.release();
      restore();
    }

    const outcomes = (await both).map(outcomeOf);
    expect(outcomes).toContain('left');
    expect(outcomes).toContainEqual(LAST_ADMIN);
    expect(await activeAdmins(harness, [adminId, secondAdminId])).toBe(1);
  });
}
