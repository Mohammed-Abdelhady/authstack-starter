import { ValidationFailedException } from '../../src/common/exceptions/validation-failed.exception';
import { ConfigService } from '@nestjs/config';
import { SecurityEventRecorder } from '../../src/session/events/security-event-recorder';
import { eventAtomicityCases } from '../utils/session/proofs-events-contract/event-atomicity-cases';
import { ProofsEventsContractHarness } from '../utils/session/proofs-events-contract/proofs-events-contract-harness';
import {
  contractEvent,
  inUnitOfWork,
} from '../utils/session/proofs-events-contract/proofs-events-contract-support';
import { TEST_NOW } from '../utils/frozen-clock';
import { ActivityQuery } from '../../src/session/events/types/activity-event';

const QUERY: ActivityQuery = { page: 1, limit: 10 };

export function describeActivityContract(
  name: string,
  boot: () => Promise<ProofsEventsContractHarness>,
  budgets: { bootMs: number; teardownMs: number; resetMs: number },
): void {
  describe(`staff activity evidence on ${name}`, () => {
    let harness: ProofsEventsContractHarness | undefined;
    const current = (): ProofsEventsContractHarness => {
      if (!harness) throw new Error('Activity harness did not start');
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

    eventAtomicityCases(current);

    it('stores staff evidence despite a caller-supplied sign-in classification', async () => {
      const input = {
        actorId: 'staff-1',
        targetUserId: 'deleted-account',
        clientId: 'admin',
        action: 'account_updated',
        kind: 'sign_in',
        outcome: 'succeeded',
        details: { name: 'Ada', changedFields: ['name'] },
      };
      await current().recorder.recordOutsideUnitOfWork(input);
      const result = await current().events.listActivity(QUERY, TEST_NOW);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        actorId: 'staff-1',
        targetUserId: 'deleted-account',
        clientId: 'admin',
        action: 'account_updated',
        kind: 'staff',
        outcome: 'succeeded',
        occurredAt: TEST_NOW,
        details: { name: 'Ada', changedFields: ['name'] },
        purgeAfter: new Date('2101-01-01T12:00:00.000Z'),
      });
    });

    it('honors configured retention without extending sign-in retention', async () => {
      const recorder = new SecurityEventRecorder(
        current().events,
        current().clock,
        new ConfigService({ activity: { retentionDays: 30 } }),
      );
      await recorder.recordOutsideUnitOfWork({
        actorId: 'staff-1',
        action: 'account_deleted',
      });
      const result = await current().events.listActivity(QUERY, TEST_NOW);
      expect(result.data[0].purgeAfter).toEqual(
        new Date('2099-01-31T12:00:00.000Z'),
      );
    });

    it('leaves no evidence from the aborted transaction attempt', async () => {
      let attempt = 0;
      await inUnitOfWork(current(), async (work) => {
        attempt += 1;
        await current().recorder.record(work, {
          actorId: 'staff-1',
          action: 'account_deleted',
        });
        if (attempt === 1)
          throw Object.assign(new Error('retry this aborted attempt'), {
            code: '40001',
            errorLabels: ['TransientTransactionError'],
          });
      });
      const result = await current().events.listActivity(QUERY, TEST_NOW);
      expect({
        attempt,
        total: result.total,
        rows: result.data.length,
      }).toEqual({ attempt: 2, total: 1, rows: 1 });
    });

    it('preserves role assignment columns and deterministic pending deletion evidence', async () => {
      await inUnitOfWork(current(), async (work) => {
        await current().recorder.record(work, {
          actorId: 'staff-1',
          targetUserId: 'target',
          action: 'sessions_revoked_all',
          roleAssignment: {
            assignedRoleId: 'new-role',
            previousRoleId: 'old-role',
            sessionVersion: 7,
          },
        });
        const deletion = {
          roleId: 'old-role',
          previousSlug: 'support',
          actorId: 'staff-1',
          sweepId: 'repair-1',
          details: {
            password: 'sensitive-sentinel',
            token: 'sensitive-sentinel',
            code: 'sensitive-sentinel',
            cookie: 'sensitive-sentinel',
            headers: 'sensitive-sentinel',
            mailBody: 'sensitive-sentinel',
          },
        };
        await current().recorder.recordRoleDeletion(work, deletion);
      });
      const result = await current().events.listActivity(QUERY, TEST_NOW);
      expect(result.total).toBe(2);
      expect(result.data[0]).toMatchObject({
        eventId: 'role-deletion:old-role',
        roleDeletionSweep: {
          roleId: 'old-role',
          previousSlug: 'support',
          actorId: 'staff-1',
          sweepId: 'repair-1',
          pending: true,
        },
      });
      expect(result.data[1].roleAssignment).toEqual({
        assignedRoleId: 'new-role',
        previousRoleId: 'old-role',
        sessionVersion: 7,
      });
      const serialized = JSON.stringify(result.data.map((row) => row.details));
      expect(serialized).not.toContain('sensitive-sentinel');
    });

    it('rejects sensitive details through recorder, batch and direct store before storing evidence', async () => {
      for (const field of [
        'password',
        'token',
        'code',
        'cookie',
        'headers',
        'mailBody',
      ]) {
        const input = {
          actorId: 'staff-1',
          action: 'account_updated',
          details: { [field]: 'sensitive-sentinel' },
        };
        await expect(
          current().recorder.recordOutsideUnitOfWork(input),
        ).rejects.toThrow(TypeError);
        await expect(
          inUnitOfWork(current(), (work) =>
            current().recorder.recordMany(work, [
              { actorId: 'staff-1', action: 'account_deleted' },
              input,
            ]),
          ),
        ).rejects.toThrow(TypeError);
        await expect(
          current().events.appendOutsideUnitOfWork(contractEvent('bad', input)),
        ).rejects.toThrow(TypeError);
      }
      expect(await current().storedEventIds()).toEqual([]);
    });

    it('excludes sign-in, actorless ADMIN_FORCED and overdue staff evidence from rows and totals', async () => {
      await current().recorder.recordOutsideUnitOfWork({
        action: 'session_issued',
      });
      await current().recorder.recordOutsideUnitOfWork({
        action: 'sessions_revoked_all',
        reasonCode: 'admin_forced',
        targetUserId: 'actorless-forced-target',
      });
      await current().events.appendOutsideUnitOfWork(
        contractEvent('expired', {
          actorId: 'staff-1',
          action: 'account_deleted',
          purgeAfter: TEST_NOW,
        }),
      );
      const result = await current().events.listActivity(QUERY, TEST_NOW);
      expect(result).toEqual({ data: [], total: 0 });
      const actorless = await current().events.listRecentForUser(
        'actorless-forced-target',
        10,
      );
      expect(actorless[0]).toMatchObject({
        action: 'sessions_revoked_all',
        actorId: null,
        reasonCode: 'admin_forced',
        kind: 'sign_in',
        purgeAfter: new Date('2099-04-01T12:00:00.000Z'),
      });
      await current().recorder.recordOutsideUnitOfWork({
        action: 'session_issued',
        targetUserId: 'sign-in-target',
      });
      const recent = await current().events.listRecentForUser(
        'sign-in-target',
        10,
      );
      expect(recent[0]).toMatchObject({
        kind: 'sign_in',
        details: {},
        purgeAfter: new Date('2099-04-01T12:00:00.000Z'),
      });
    });

    it('refuses operator objects, arrays and SQL fragments at the store boundary', async () => {
      await expect(
        current().events.listActivity(
          Object.assign({}, QUERY, { 'actor[$ne]': 'staff-1' }),
          TEST_NOW,
        ),
      ).rejects.toThrow(ValidationFailedException);
      for (const value of [{ $ne: null }, ['staff-1'], "staff-1' OR 1=1 --"]) {
        for (const field of ['actor', 'action', 'target']) {
          const query = Object.assign({}, QUERY, { [field]: value });
          await expect(
            current().events.listActivity(query, TEST_NOW),
          ).rejects.toThrow(ValidationFailedException);
        }
      }
    });
  });
}
