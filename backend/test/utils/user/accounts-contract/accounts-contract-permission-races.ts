import { holdBefore, RaceGate } from '../../race-gate';
import { AccountsHarnessSource } from './accounts-contract-support';
import {
  accountCase,
  AccountsFixture,
  MANAGER_SLUG,
  READ_USERS,
  refusalOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

/** A permission grant must use the actor's current grants at its write. */
export function accountPermissionRaceCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  accountCase(
    'refuses a direct permission grant if its actor lost that permission before the unit of work',
    async () => {
      const { userId, managerId } = fixture();
      const permission = 'reports:export:all';
      await harness().alterAccount(managerId, { permissions: [permission] });

      const admitted = new RaceGate();
      const restore = holdBefore(
        harness().admin,
        'takeAccountForChange',
        (call) => (call === 0 ? admitted : undefined),
      );
      const refusal = refusalOf(
        servicesOn(harness()).adminPermissions.addPermission(
          userId,
          permission,
          managerId,
          MANAGER_SLUG,
        ),
      );
      try {
        await admitted.reached(1);
        await harness().alterAccount(managerId, { permissions: [] });
      } finally {
        admitted.release();
        restore();
      }

      await expect(refusal).resolves.toEqual({
        code: 'FORBIDDEN',
        status: 403,
      });
      expect((await storedAccount(harness(), userId)).permissions).toEqual([
        READ_USERS,
      ]);
    },
  );
}
