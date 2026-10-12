import { holdBefore, RaceGate } from '../../race-gate';
import { AccountsContractHarness } from './accounts-contract-harness';
import {
  accountCase,
  AccountServices,
  AccountsFixture,
  AccountsHarnessSource,
  ADMIN_SLUG,
  DEFAULT_SLUG,
  EDITOR_SLUG,
  MANAGER_SLUG,
  READ_POSTS,
  READ_USERS,
  refusalOf,
  revocationsOf,
  servicesOn,
  storedAccount,
} from './accounts-contract-support';

const HIGHER_ROLE = { code: 'CANNOT_MODIFY_HIGHER_ROLE', status: 403 };
const ACTOR_GONE = { code: 'SESSION_INVALID', status: 401 };
const NOT_FOUND = { code: 'USER_NOT_FOUND', status: 404 };

type Mutation = (
  services: AccountServices,
  fixture: AccountsFixture,
) => Promise<unknown>;

/** Every change a manager can make to the plain account. */
const MANAGER_MUTATIONS: Array<[string, Mutation]> = [
  [
    'a deactivation',
    (services, { userId, managerId }) =>
      services.adminUsers.updateUserStatus(
        userId,
        { isActive: false },
        managerId,
      ),
  ],
  [
    'a role assignment',
    (services, { userId, managerId }) =>
      services.adminUsers.updateUserRole(
        userId,
        { role: EDITOR_SLUG },
        managerId,
        MANAGER_SLUG,
      ),
  ],
  [
    'a rename',
    (services, { userId, managerId }) =>
      services.adminUsers.updateUser(
        userId,
        { name: 'Renamed' },
        managerId,
        MANAGER_SLUG,
      ),
  ],
  [
    'a deletion',
    (services, { userId, managerId }) =>
      services.adminUsers.deleteUser(userId, managerId),
  ],
  [
    'a permission grant',
    (services, { userId, managerId }) =>
      services.adminPermissions.addPermission(
        userId,
        READ_POSTS,
        managerId,
        MANAGER_SLUG,
      ),
  ],
  [
    'a permission revocation',
    (services, { userId, managerId }) =>
      services.adminPermissions.removePermission(
        userId,
        READ_USERS,
        managerId,
        MANAGER_SLUG,
      ),
  ],
];

/**
 * Runs the mutation up to its first read inside the unit of work, makes the
 * change behind its back, and lets it go on.
 */
async function withChangeAfterTheCheck(
  harness: AccountsContractHarness,
  mutate: () => Promise<unknown>,
  change: () => Promise<void>,
): Promise<{ code: unknown; status: unknown }> {
  const admitted = new RaceGate();
  const restore = holdBefore(harness.admin, 'takeAccountForChange', (call) =>
    call === 0 ? admitted : undefined,
  );
  const refusal = refusalOf(mutate());
  try {
    await admitted.reached(1);
    await change();
  } finally {
    admitted.release();
    restore();
  }
  return refusal;
}

/** Nothing about the plain account changed and nobody was signed out. */
async function expectUntouched(
  harness: AccountsContractHarness,
  userId: string,
): Promise<void> {
  expect(await storedAccount(harness, userId)).toMatchObject({
    name: 'Plain Person',
    role: DEFAULT_SLUG,
    permissions: [READ_USERS],
    isDeleted: false,
    sessionVersion: 0,
  });
  expect(await revocationsOf(harness)).toEqual([]);
}

/**
 * The actor and the target are read again inside the unit of work, and a
 * change either of them went through after the request was admitted decides.
 */
export function accountFreshnessCases(
  harness: AccountsHarnessSource,
  fixture: () => AccountsFixture,
): void {
  describe.each(MANAGER_MUTATIONS)('%s', (_name, mutation) => {
    accountCase('is refused when the actor was demoted meanwhile', async () => {
      const { userId, managerId } = fixture();

      const refusal = await withChangeAfterTheCheck(
        harness(),
        () => mutation(servicesOn(harness()), fixture()),
        () => harness().alterAccount(managerId, { role: DEFAULT_SLUG }),
      );

      expect(refusal).toEqual(HIGHER_ROLE);
      await expectUntouched(harness(), userId);
    });

    accountCase(
      'is refused when the actor was deactivated meanwhile',
      async () => {
        const { userId, managerId } = fixture();

        const refusal = await withChangeAfterTheCheck(
          harness(),
          () => mutation(servicesOn(harness()), fixture()),
          () => harness().alterAccount(managerId, { deleted: true }),
        );

        expect(refusal).toEqual(ACTOR_GONE);
        await expectUntouched(harness(), userId);
      },
    );

    accountCase(
      'is refused when the target was promoted meanwhile',
      async () => {
        const { userId } = fixture();

        const refusal = await withChangeAfterTheCheck(
          harness(),
          () => mutation(servicesOn(harness()), fixture()),
          () => harness().alterAccount(userId, { role: MANAGER_SLUG }),
        );

        expect(refusal).toEqual(HIGHER_ROLE);
        expect(await storedAccount(harness(), userId)).toMatchObject({
          name: 'Plain Person',
          role: MANAGER_SLUG,
          isDeleted: false,
          sessionVersion: 0,
        });
      },
    );

    accountCase(
      'is refused when the target was deactivated meanwhile',
      async () => {
        const { userId } = fixture();

        const refusal = await withChangeAfterTheCheck(
          harness(),
          () => mutation(servicesOn(harness()), fixture()),
          () => harness().alterAccount(userId, { deleted: true }),
        );

        expect(refusal).toEqual(NOT_FOUND);
        expect(await storedAccount(harness(), userId)).toMatchObject({
          name: 'Plain Person',
          role: DEFAULT_SLUG,
          sessionVersion: 0,
        });
      },
    );

    accountCase(
      'does not change session state when security events cannot be recorded',
      async () => {
        const { userId } = fixture();
        const restore = await harness().refuseSecurityEvents();
        try {
          await mutation(servicesOn(harness()), fixture()).catch(
            () => undefined,
          );
        } finally {
          restore();
        }

        // These account changes do not revoke the target's sessions.
        const stored = await storedAccount(harness(), userId);
        expect({
          role: stored.role,
          isDeleted: stored.isDeleted,
          sessionVersion: stored.sessionVersion,
        }).toEqual({ role: DEFAULT_SLUG, isDeleted: false, sessionVersion: 0 });
      },
    );
  });

  accountCase(
    'refuses a reactivation by an actor demoted meanwhile',
    async () => {
      const { userId, managerId } = fixture();
      await harness().alterAccount(userId, { deleted: true });

      const refusal = await withChangeAfterTheCheck(
        harness(),
        () =>
          servicesOn(harness()).adminUsers.updateUserStatus(
            userId,
            { isActive: true },
            managerId,
          ),
        () => harness().alterAccount(managerId, { role: DEFAULT_SLUG }),
      );

      expect(refusal).toEqual(HIGHER_ROLE);
      expect((await storedAccount(harness(), userId)).isDeleted).toBe(true);
    },
  );

  accountCase('refuses a creation by an actor demoted meanwhile', async () => {
    const { managerId } = fixture();
    const admitted = new RaceGate();
    const restore = holdBefore(harness().admin, 'readRoleBySlug', (call) =>
      call === 0 ? admitted : undefined,
    );
    const refusal = refusalOf(
      servicesOn(harness()).adminCreate.createUser(
        {
          email: 'never@example.test',
          name: 'Never',
          password: 'CreatedPassword123!',
          role: DEFAULT_SLUG,
        },
        MANAGER_SLUG,
        managerId,
      ),
    );
    try {
      await admitted.reached(1);
      await harness().alterAccount(managerId, { role: DEFAULT_SLUG });
    } finally {
      admitted.release();
      restore();
    }

    expect(await refusal).toEqual(HIGHER_ROLE);
    expect(await harness().accountIdByEmail('never@example.test')).toBeNull();
  });

  accountCase(
    'refuses an address change by an admin demoted meanwhile',
    async () => {
      const { userId, adminId } = fixture();

      const refusal = await withChangeAfterTheCheck(
        harness(),
        () =>
          servicesOn(harness()).adminUsers.updateUser(
            userId,
            { email: 'moved@example.test' },
            adminId,
            ADMIN_SLUG,
          ),
        () => harness().alterAccount(adminId, { role: MANAGER_SLUG }),
      );

      expect(refusal).toEqual({
        code: 'EMAIL_CHANGE_NOT_ALLOWED',
        status: 403,
      });
      expect(await storedAccount(harness(), userId)).toMatchObject({
        email: 'person@example.test',
        isVerified: true,
        addressGeneration: 0,
      });
    },
  );
}
