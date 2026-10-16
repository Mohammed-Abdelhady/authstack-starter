import { describeErasureDataContract } from './erasure.contract-data.harness-spec';
import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { UniqueConflictError } from '../../common/persistence/persistence-errors';
import { ERASURE_STEP, ERASURE_STANDING } from './constants/erasure.constants';
import {
  AccountDeletionStore,
  DELETION_RECEIPT_CONSTRAINT,
} from './stores/account-deletion.store';
import { AccountEraser } from './stores/account-eraser';
import { ErasureJobStore } from './stores/erasure-job.store';
import type { ErasureLease } from './types/erasure';

export interface ErasureAccount {
  id: string;
  email: string;
  pendingEmail: string;
}
export interface ErasureEvent {
  eventId: string;
  actorId: string;
  targetUserId: string;
  action: string;
  details: Record<string, unknown>;
}
export interface ErasureHarness {
  jobs: ErasureJobStore;
  deletion: AccountDeletionStore;
  eraser: AccountEraser;
  runner: UnitOfWorkRunner;
  clock: FrozenClock;
  seedAccount(
    email: string,
    deleted?: boolean,
    eraseAfter?: Date,
  ): Promise<ErasureAccount>;
  schedule(id: string): Promise<Date | null>;
  /** Deactivates as a staff action or a deletion does, at `deletedAt`. */
  deactivate(id: string, deletedAt: Date): Promise<void>;
  seedChildren(account: ErasureAccount): Promise<void>;
  counts(account: ErasureAccount): Promise<Record<string, number>>;
  events(): Promise<ErasureEvent[]>;
  reset(): Promise<void>;
  close(): Promise<void>;
  checkSetup(): Promise<void>;
}
export const ERASURE_PAST = new Date('2099-01-01T11:00:00.000Z');
export const ERASURE_FUTURE = new Date('2099-01-02T12:00:00.000Z');
const LEASE_END = new Date('2099-01-01T12:01:00.000Z');
const RETRY_AT = new Date('2099-01-01T12:02:00.000Z');
const PURGE_AT = new Date('2099-04-01T12:00:00.000Z');
const RECEIPT_HASH = 'a'.repeat(64);
export function describeErasureContract(
  name: string,
  boot: () => Promise<ErasureHarness>,
  timeouts: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`${name} account erasure`, () => {
    let h: ErasureHarness;
    beforeAll(async () => {
      h = await boot();
    }, timeouts.bootMs);
    afterAll(async () => {
      await h?.close();
    }, timeouts.teardownMs);
    beforeEach(async () => {
      h.clock.set(TEST_NOW);
      await h.reset();
    }, timeouts.resetMs);
    const lease = (owner = 'worker-a'): ErasureLease => ({
      owner,
      now: h.clock.now(),
      until: LEASE_END,
    });
    const begin = (id: string, owner?: string) =>
      h.runner.run((u) => h.jobs.beginIn(u, id, lease(owner)));
    async function begun(id: string) {
      const result = await begin(id);
      if (!result) throw new Error('Due account was not claimed');
      return result;
    }
    const account = (email = 'erase@example.test') =>
      h.seedAccount(email, true, ERASURE_PAST);
    it('has the erasure uniqueness and retention indexes', async () => {
      await h.checkSetup();
    });
    it('excludes active, unscheduled, future, finished, leased and waiting accounts before limiting due results', async () => {
      const erased = await account('erased@example.test');
      const finished = await begun(erased.id);
      await h.runner.run((u) =>
        h.jobs.finishIn(u, finished.job.id, TEST_NOW, PURGE_AT),
      );
      const leased = await account('leased@example.test');
      await begun(leased.id);
      const waiting = await account('waiting@example.test');
      const job = await begun(waiting.id);
      await h.jobs.markFailed(job.job.id, 'worker-a', {
        code: 'hook_failed',
        at: TEST_NOW,
        nextAttemptAt: RETRY_AT,
      });
      await h.seedAccount('active@example.test', false, ERASURE_PAST);
      await h.seedAccount('future@example.test', true, ERASURE_FUTURE);
      await h.seedAccount('unscheduled@example.test', true);
      const due = await h.seedAccount('due@example.test', true, TEST_NOW);
      const oldest = await h.seedAccount(
        'oldest@example.test',
        true,
        new Date('2099-01-01T11:59:59.999Z'),
      );
      expect(await h.jobs.findDue(TEST_NOW, 1)).toEqual([oldest.id]);
      expect(await h.jobs.findDue(TEST_NOW, 2)).toEqual([oldest.id, due.id]);
    });
    it('keeps one job and its progress when an expired lease changes owners', async () => {
      const user = await account();
      const first = await begun(user.id);
      expect(first.job).toMatchObject({
        userId: user.id,
        step: 'erasing',
        attempts: 0,
        startedAt: TEST_NOW,
      });
      expect({ accountId: first.accountId, ...first.onAccount }).toEqual({
        accountId: user.id,
        address: user.email,
        pendingAddress: user.pendingEmail,
      });
      expect(await begin(user.id, 'worker-b')).toBeNull();
      expect(await h.jobs.markHookDone(first.job.id, lease())).toBe(true);
      h.clock.set(LEASE_END);
      const resumed = await begin(user.id, 'worker-b');
      expect(resumed?.job).toMatchObject({
        id: first.job.id,
        step: 'hook_done',
      });
    });
    it('clears the schedule before erasure and refuses restoration once step one committed', async () => {
      const restorable = await account();
      expect(
        await h.runner.run((u) => h.jobs.holdForRestoreIn(u, restorable.id)),
      ).toBe(ERASURE_STANDING.RESTORABLE);
      expect(await h.schedule(restorable.id)).toBeNull();
      expect(await h.jobs.findDue(TEST_NOW, 10)).toEqual([]);
      const erasing = await account('started@example.test');
      await begun(erasing.id);
      expect(
        await h.runner.run((u) => h.jobs.holdForRestoreIn(u, erasing.id)),
      ).toBe(ERASURE_STANDING.ERASING);
    });
    it('allows only the lease owner to advance or fail a job and releases it until retry', async () => {
      const user = await account();
      const first = await begun(user.id);
      expect(await h.jobs.markHookDone(first.job.id, lease('worker-b'))).toBe(
        false,
      );
      await h.jobs.markFailed(first.job.id, 'worker-b', {
        code: 'wrong_owner',
        at: TEST_NOW,
        nextAttemptAt: RETRY_AT,
      });
      expect((await h.jobs.listOpen(10))[0]?.attempts).toBe(0);
      expect(await h.jobs.markHookDone(first.job.id, lease())).toBe(true);
      await h.jobs.markFailed(first.job.id, 'worker-a', {
        code: 'erase_failed',
        at: TEST_NOW,
        nextAttemptAt: RETRY_AT,
      });
      expect((await h.jobs.listOpen(10))[0]).toMatchObject({
        step: ERASURE_STEP.HOOK_DONE,
        attempts: 1,
        failureCode: 'erase_failed',
        failedAt: TEST_NOW,
        nextAttemptAt: RETRY_AT,
      });
      expect(await h.jobs.findDue(TEST_NOW, 10)).toEqual([]);
      expect(await begin(user.id, 'worker-b')).toBeNull();
      h.clock.set(RETRY_AT);
      expect(await h.jobs.findDue(RETRY_AT, 10)).toEqual([user.id]);
      expect((await begin(user.id, 'worker-b'))?.job.id).toBe(first.job.id);
    });
    it('reads step 3 facts only for an account still deactivated and due', async () => {
      const restored = await h.seedAccount(
        'restored@example.test',
        false,
        ERASURE_PAST,
      );
      const unscheduled = await h.seedAccount('unscheduled@example.test', true);
      const later = await h.seedAccount(
        'later@example.test',
        true,
        ERASURE_FUTURE,
      );
      const due = await account();
      const read = (id: string) =>
        h.runner.run((u) => h.eraser.readFactsIn(u, id, h.clock.now()));
      expect(await read(restored.id)).toBeNull();
      expect(await read(unscheduled.id)).toBeNull();
      expect(await read(later.id)).toBeNull();
      expect((await read(due.id))?.accountId).toBe(due.id);
    });
    it('withdraws an unfinished job so a restore goes on, and never a finished one', async () => {
      const open = await account('open@example.test');
      const done = await account('done@example.test');
      const opened = await begun(open.id);
      const finished = await begun(done.id);
      await h.runner.run(async (u) => {
        await h.jobs.finishIn(u, finished.job.id, TEST_NOW, PURGE_AT);
        await h.jobs.withdrawIn(u, opened.job.id);
        await h.jobs.withdrawIn(u, finished.job.id);
      });
      const standing = (id: string) =>
        h.runner.run((u) => h.jobs.holdForRestoreIn(u, id));
      expect(await standing(open.id)).toBe(ERASURE_STANDING.RESTORABLE);
      expect(await standing(done.id)).toBe(ERASURE_STANDING.ERASING);
    });
    it('finishes the persisted job once', async () => {
      const user = await account();
      const first = await begun(user.id);
      expect(
        await h.runner.run((u) =>
          h.jobs.finishIn(u, first.job.id, TEST_NOW, PURGE_AT),
        ),
      ).toBe(true);
      expect(
        await h.runner.run((u) =>
          h.jobs.finishIn(u, first.job.id, TEST_NOW, PURGE_AT),
        ),
      ).toBe(false);
      expect(await h.jobs.listOpen(10)).toEqual([]);
    });
    describeErasureDataContract(() => h, ERASURE_PAST);
    it('records receipts once, reads them in and after the transaction, and clears a null schedule', async () => {
      const mine = await account();
      const record = {
        userId: mine.id,
        deletedAt: TEST_NOW,
        eraseAfter: ERASURE_FUTURE,
        receipt: {
          keyHash: RECEIPT_HASH,
          operation: 'account_deletion',
          recordedAt: TEST_NOW,
          purgeAfter: PURGE_AT,
        },
      };
      const expected = {
        userId: mine.id,
        eraseAfter: ERASURE_FUTURE,
        recordedAt: TEST_NOW,
      };
      await h.runner.run(async (u) => {
        await h.deletion.recordIn(u, record);
        expect(await h.deletion.findReceiptIn(u, RECEIPT_HASH)).toEqual(
          expected,
        );
      });
      expect(await h.deletion.findReceipt(RECEIPT_HASH)).toEqual(expected);
      expect(await h.schedule(mine.id)).toEqual(ERASURE_FUTURE);
      const duplicate = h.runner.run((u) => h.deletion.recordIn(u, record));
      await expect(duplicate).rejects.toBeInstanceOf(UniqueConflictError);
      await expect(duplicate).rejects.toMatchObject({
        constraint: DELETION_RECEIPT_CONSTRAINT.KEY,
      });
      await h.runner.run((u) =>
        h.deletion.recordIn(u, {
          userId: mine.id,
          deletedAt: TEST_NOW,
          eraseAfter: null,
        }),
      );
      expect(await h.schedule(mine.id)).toBeNull();
      expect(await h.deletion.findReceipt('missing')).toBeNull();
    });
    it("dates a person's own deletions, and unmarked ones only before the time given", async () => {
      const deactivated = async (email: string, at: Date, own: boolean) => {
        const seeded = await h.seedAccount(email);
        await h.deactivate(seeded.id, at);
        const record = { userId: seeded.id, deletedAt: at, eraseAfter: null };
        if (own) await h.runner.run((u) => h.deletion.recordIn(u, record));
        return seeded;
      };
      const first = await deactivated('own-1@example.test', ERASURE_PAST, true);
      const second = await deactivated(
        'own-2@example.test',
        ERASURE_PAST,
        true,
      );
      const staff = await deactivated(
        'staff@example.test',
        ERASURE_PAST,
        false,
      );
      const late = await deactivated('late@example.test', TEST_NOW, false);
      // Deleted by the person, restored, and later deactivated by staff.
      const restored = await deactivated(
        'back@example.test',
        ERASURE_PAST,
        true,
      );
      await h.deactivate(restored.id, TEST_NOW);
      const scheduled = await account();
      const active = await h.seedAccount('active@example.test');
      const own = { eraseAfter: ERASURE_FUTURE };
      expect(await h.jobs.scheduleUnscheduled(own, 1)).toBe(1);
      expect(await h.jobs.scheduleUnscheduled(own, 10)).toBe(1);
      expect(await h.schedule(first.id)).toEqual(ERASURE_FUTURE);
      expect(await h.schedule(second.id)).toEqual(ERASURE_FUTURE);
      for (const kept of [staff, late, restored, active])
        expect(await h.schedule(kept.id)).toBeNull();
      expect(await h.schedule(scheduled.id)).toEqual(ERASURE_PAST);
      const unmarked = { ...own, deletedBefore: TEST_NOW };
      expect(await h.jobs.scheduleUnscheduled(unmarked, 10)).toBe(1);
      expect(await h.schedule(staff.id)).toEqual(ERASURE_FUTURE);
      for (const kept of [late, restored])
        expect(await h.schedule(kept.id)).toBeNull();
    });
  });
}
