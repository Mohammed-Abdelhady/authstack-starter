import { holdBefore, RaceGate } from '../../race-gate';
import { holdReruns } from '../../session/issuance-contract/issuance-contract-support';
import {
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  answerOf,
  DEFAULT_SLUG,
  MANAGER_SLUG,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const HIGHER_ROLE = { code: 'CANNOT_MODIFY_HIGHER_ROLE', status: 403 };
const NOT_FOUND = { code: 'USER_NOT_FOUND', status: 404 };

/** Two admins changing one account at the same time. */
export function accountRaceCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  it('never lets a deletion land on a target promoted while it was deciding', async () => {
    const { userId, managerId, adminId } = fixture();
    const reruns = holdReruns();
    const services = servicesOn(harness(), reruns.pause);
    const atSave = new RaceGate();
    const restore = holdBefore(harness().admin, 'saveActivation', () => atSave);
    // The manager's deletion has checked the target and not written it yet.
    const deletion = services.adminUsers.deleteUser(userId, managerId);
    await atSave.reached(1);
    // An admin makes the target the manager's peer.
    const promotion = services.adminUsers.updateUserRole(
      userId,
      { role: MANAGER_SLUG },
      adminId,
      ADMIN_SLUG,
    );
    const both = Promise.allSettled([deletion, promotion]);
    try {
      // The promotion landed, or was refused because the target is taken.
      await Promise.race([
        promotion.catch(() => undefined),
        reruns.refused.reached(1),
      ]);
      atSave.release();
      await Promise.race([deletion, promotion]).catch(() => undefined);
    } finally {
      atSave.release();
      reruns.refused.release();
      restore();
    }

    const [deleted, promoted] = await both;
    const stored = await storedAccount(harness(), userId);
    const outcome = {
      deletion:
        deleted.status === 'fulfilled' ? 'deleted' : answerOf(deleted.reason),
      promotion:
        promoted.status === 'fulfilled'
          ? 'promoted'
          : answerOf(promoted.reason),
      role: stored.role,
      isDeleted: stored.isDeleted,
    };
    // One of them won and the other saw what it stored. A manager never
    // deletes an account that is a manager by then.
    expect([
      {
        deletion: 'deleted',
        promotion: NOT_FOUND,
        role: DEFAULT_SLUG,
        isDeleted: true,
      },
      {
        deletion: HIGHER_ROLE,
        promotion: 'promoted',
        role: MANAGER_SLUG,
        isDeleted: false,
      },
    ]).toContainEqual(outcome);
  });
}
