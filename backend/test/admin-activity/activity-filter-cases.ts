import {
  HarnessSource,
  contractEvent,
} from '../utils/session/proofs-events-contract/proofs-events-contract-support';
import { ProofsEventsContractHarness } from '../utils/session/proofs-events-contract/proofs-events-contract-harness';
import { TEST_NOW } from '../utils/frozen-clock';

const QUERY = { page: 1, limit: 10 };

export function activityFilterCases(current: HarnessSource): void {
  it('looks up permitted underscores literally instead of matching lookalike identifiers', async () => {
    for (const [id, actorId, targetUserId] of [
      ['exact', 'staff_1', 'target_1'],
      ['lookalike', 'staffA1', 'targetA1'],
    ]) {
      await current().events.appendOutsideUnitOfWork(
        contractEvent(id, { action: 'account_deleted', actorId, targetUserId }),
      );
    }
    for (const filter of [{ actor: 'staff_1' }, { target: 'target_1' }]) {
      const result = await current().events.listActivity(
        { ...QUERY, ...filter },
        TEST_NOW,
      );
      expect({
        ids: result.data.map((row) => row.eventId),
        total: result.total,
      }).toEqual({ ids: ['exact'], total: 1 });
    }
  });

  it('combines scalar filters with inclusive from and exclusive to in rows and totals', async () => {
    await seedFiltered(current());
    const result = await current().events.listActivity(
      {
        ...QUERY,
        actor: 'staff-1',
        action: 'account_deleted',
        target: 'target',
        from: TEST_NOW,
        to: new Date('2099-01-01T12:00:01.000Z'),
      },
      TEST_NOW,
    );
    expect({
      ids: result.data.map((row) => row.eventId),
      total: result.total,
    }).toEqual({ ids: ['matching'], total: 1 });
    for (const [key, value, expected] of [
      ['actor', 'staff-2', 'actor'],
      ['action', 'account_updated', 'action'],
      ['target', 'other', 'target'],
    ]) {
      const filtered = await current().events.listActivity(
        { ...QUERY, [key]: value },
        TEST_NOW,
      );
      expect(filtered.total).toBe(1);
      expect(filtered.data.map((row) => row.eventId)).toEqual([expected]);
    }
    const fromOnly = await current().events.listActivity(
      { ...QUERY, from: TEST_NOW },
      TEST_NOW,
    );
    expect({
      total: fromOnly.total,
      ids: fromOnly.data.map((row) => row.eventId),
    }).toEqual({
      total: 5,
      ids: ['at-to', 'target', 'action', 'actor', 'matching'],
    });
    const toOnly = await current().events.listActivity(
      { ...QUERY, to: TEST_NOW },
      TEST_NOW,
    );
    expect({
      total: toOnly.total,
      ids: toOnly.data.map((row) => row.eventId),
    }).toEqual({
      total: 1,
      ids: ['before-from'],
    });
    const window = await current().events.listActivity(
      { ...QUERY, from: TEST_NOW, to: new Date('2099-01-01T12:00:01.000Z') },
      TEST_NOW,
    );
    expect({
      total: window.total,
      ids: window.data.map((row) => row.eventId),
    }).toEqual({
      total: 4,
      ids: ['target', 'action', 'actor', 'matching'],
    });
  });
}

async function seedFiltered(
  harness: ProofsEventsContractHarness,
): Promise<void> {
  for (const [id, overrides] of [
    ['matching', {}],
    ['actor', { actorId: 'staff-2' }],
    ['action', { action: 'account_updated' }],
    ['target', { targetUserId: 'other' }],
    ['at-to', { occurredAt: new Date('2099-01-01T12:00:01.000Z') }],
    ['before-from', { occurredAt: new Date('2099-01-01T11:59:59.999Z') }],
  ] as const) {
    await harness.events.appendOutsideUnitOfWork(
      contractEvent(id, {
        action: 'account_deleted',
        actorId: 'staff-1',
        targetUserId: 'target',
        ...overrides,
      }),
    );
  }
}
