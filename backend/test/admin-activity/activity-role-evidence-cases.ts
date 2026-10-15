import { finishBootstrap } from '../../src/role/services/bootstrap/role-bootstrap.harness-spec';
import { TEST_NOW } from '../utils/frozen-clock';
import { RoleContractHarness } from '../utils/role/role-contract/role-contract-harness';
import {
  seedRoleFixture,
  servicesOn,
} from '../utils/role/role-contract/role-contract-support';
import { rerunAtOnce } from '../utils/session/issuance-contract/issuance-contract-support';

export function describeActivityRoleEvidence(
  database: string,
  boot: () => Promise<RoleContractHarness>,
  budgets: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`activity evidence consumed by role repair on ${database}`, () => {
    let harness: RoleContractHarness | undefined;
    const current = (): RoleContractHarness => {
      if (!harness) throw new Error('Role evidence fixture did not start');
      return harness;
    };
    beforeAll(async () => {
      harness = await boot();
    }, budgets.bootMs);
    beforeEach(async () => {
      current().clock.set(TEST_NOW);
      await current().reset();
    }, budgets.resetMs);
    afterAll(async () => {
      await harness?.close();
    }, budgets.teardownMs);

    it('b4 and b5 feed recorded assignment and deletion evidence into startup repair once', async () => {
      const fixture = current();
      const { adminId, editorRoleId } = await seedRoleFixture(fixture);
      const goneId = await fixture.seedRole({
        name: 'Temporary',
        slug: 'temporary',
        permissions: [],
      });
      const previousHolder = await fixture.seedAccount({ role: 'temporary' });
      const defaultHolder = await fixture.seedAccount({ role: 'temporary' });
      const assignment = {
        actorId: adminId,
        targetUserId: previousHolder,
        action: 'sessions_revoked_all',
        reasonCode: 'admin_forced',
        roleAssignment: {
          assignedRoleId: goneId,
          previousRoleId: editorRoleId,
          sessionVersion: 7,
        },
      };
      const noPrevious = {
        actorId: adminId,
        targetUserId: defaultHolder,
        action: 'sessions_revoked_all',
        reasonCode: 'admin_forced',
        roleAssignment: { assignedRoleId: goneId, sessionVersion: 1 },
      };
      await fixture
        .runner(rerunAtOnce)
        .run((work) =>
          fixture.changes.appendHolderRevocations(work, [
            assignment,
            noPrevious,
          ]),
        );
      const history = await fixture
        .runner(rerunAtOnce)
        .run((work) =>
          fixture.sweeps.readPreviousRoles(
            work,
            [previousHolder, defaultHolder],
            goneId,
          ),
        );
      expect([...history]).toEqual([[previousHolder, editorRoleId]]);
      const assignments = (await fixture.events()).filter(
        ({ action }) => action === 'sessions_revoked_all',
      );
      expect(assignments).toHaveLength(2);
      for (const targetUserId of [previousHolder, defaultHolder]) {
        expect(
          assignments.filter((event) => event.targetUserId === targetUserId),
        ).toEqual([
          {
            targetUserId,
            actorId: adminId,
            action: 'sessions_revoked_all',
            reasonCode: 'admin_forced',
          },
        ]);
      }

      const deletion = {
        roleId: goneId,
        previousSlug: 'temporary',
        actorId: adminId,
        sweepId: 'interrupted-delete',
      };
      await fixture.runner(rerunAtOnce).run(async (work) => {
        await fixture.changes.appendRoleDeletion(work, deletion);
        await fixture.changes.removeRole(work, goneId);
      });
      expect(await fixture.sweeps.listPendingDeletions(10)).toEqual([deletion]);
      expect(await fixture.account(previousHolder)).toEqual({
        role: 'temporary',
        sessionVersion: 0,
      });

      await finishBootstrap([servicesOn(fixture).bootstrap()]);
      expect(await fixture.account(previousHolder)).toEqual({
        role: 'content-editor',
        sessionVersion: 1,
      });
      expect(await fixture.account(defaultHolder)).toEqual({
        role: 'user',
        sessionVersion: 1,
      });
      expect(await fixture.sweeps.listPendingDeletions(10)).toEqual([]);
      const deletionRecord = await fixture
        .runner(rerunAtOnce)
        .run((work) => fixture.sweeps.readDeletionRecord(work, goneId));
      expect(
        deletionRecord && {
          roleId: deletionRecord.roleId,
          previousSlug: deletionRecord.previousSlug,
          actorId: deletionRecord.actorId,
          sweepId: deletionRecord.sweepId,
        },
      ).toEqual(deletion);
      expect(
        (await fixture.events()).filter(
          ({ action }) => action === 'role_deleted',
        ),
      ).toEqual([
        {
          targetUserId: null,
          actorId: adminId,
          action: 'role_deleted',
          reasonCode: null,
        },
      ]);
      const revocations = (await fixture.events()).filter(
        ({ action }) => action === 'sessions_revoked_all',
      );
      expect(revocations).toHaveLength(4);

      await finishBootstrap([servicesOn(fixture).bootstrap()]);
      expect(await fixture.account(previousHolder)).toEqual({
        role: 'content-editor',
        sessionVersion: 1,
      });
      expect(await fixture.account(defaultHolder)).toEqual({
        role: 'user',
        sessionVersion: 1,
      });
      expect(
        (await fixture.events()).filter(
          ({ action }) => action === 'sessions_revoked_all',
        ),
      ).toEqual(revocations);
    });
  });
}
