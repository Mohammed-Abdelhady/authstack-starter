import { MAIL_COUNTER_PURPOSE } from '../../../../src/auth/constants/registration';
import { MAIL_COUNTER_CONSTRAINT } from '../../../../src/auth/pending-codes/mail-counter.store';
import { UniqueConflictError } from '../../../../src/common/persistence/persistence-errors';
import { TEST_NOW } from '../../frozen-clock';
import { holdBefore, RaceGate } from '../../race-gate';
import {
  contractServices,
  ContractServices,
  HarnessSource,
  MAIL_CAP,
  MAIL_WINDOW_MS,
  rejectionOf,
} from './pending-codes-contract-support';

const EMAIL = 'counted@example.test';
const NOTICE = MAIL_COUNTER_PURPOSE.NOTICE;
const WINDOW_END = new Date('2099-01-01T12:15:00.000Z');
const SECOND_WINDOW_END = new Date('2099-01-01T12:30:00.000Z');

/** The per-address mail cap: its window, its rollover and its races. */
export function mailCounterCases(harness: HarnessSource): void {
  let services: ContractServices;

  beforeEach(async () => {
    services = await contractServices(harness());
  });

  afterEach(() => {
    services.restore();
  });

  const record = () => services.mailCounter.tryRecord(EMAIL, NOTICE);
  const fillCap = async (): Promise<void> => {
    for (let mail = 0; mail < MAIL_CAP; mail += 1) {
      await record();
    }
  };

  it('opens a counter for the first mail with a window that starts now', async () => {
    const allowed = await record();

    expect({
      allowed,
      stored: await harness().counter(EMAIL, NOTICE),
      calls: services.storeCalls,
    }).toEqual({
      allowed: true,
      stored: {
        email: EMAIL,
        purpose: 'notice',
        mailedCodes: 1,
        windowStartedAt: TEST_NOW,
        expiresAt: WINDOW_END,
      },
      calls: ['mail.recordWithinCap', 'mail.hasCounter', 'mail.openCounter'],
    });
  });

  it('allows the cap, refuses the next mail and writes nothing for it', async () => {
    const allowed: boolean[] = [];
    for (let mail = 0; mail < MAIL_CAP; mail += 1) {
      allowed.push(await record());
    }
    services.clear();

    const refused = await record();

    expect({
      allowed,
      refused,
      calls: services.storeCalls,
      stored: (await harness().counter(EMAIL, NOTICE))?.mailedCodes,
    }).toEqual({
      allowed: [true, true, true, true, true],
      refused: false,
      calls: ['mail.recordWithinCap', 'mail.hasCounter'],
      stored: 5,
    });
  });

  it('counts inside the window without moving the window', async () => {
    await record();
    harness().clock.advance(60_000);

    await record();

    expect(await harness().counter(EMAIL, NOTICE)).toEqual({
      email: EMAIL,
      purpose: 'notice',
      mailedCodes: 2,
      windowStartedAt: TEST_NOW,
      expiresAt: WINDOW_END,
    });
  });

  it('still refuses one millisecond before the window ends', async () => {
    await fillCap();
    harness().clock.advance(MAIL_WINDOW_MS - 1);

    expect(await record()).toBe(false);
  });

  it('starts a new window at one when the stored window has ended and its row is still there', async () => {
    await fillCap();
    harness().clock.advance(MAIL_WINDOW_MS);

    const allowed = await record();

    expect({
      allowed,
      stored: await harness().counter(EMAIL, NOTICE),
      rows: await harness().counterCount(),
    }).toEqual({
      allowed: true,
      stored: {
        email: EMAIL,
        purpose: 'notice',
        mailedCodes: 1,
        windowStartedAt: WINDOW_END,
        expiresAt: SECOND_WINDOW_END,
      },
      rows: 1,
    });
  });

  it('counts the same after cleanup removed the counter as after a rollover', async () => {
    await fillCap();
    harness().clock.advance(MAIL_WINDOW_MS);
    const removed = await harness().stores.mailCounters.deleteExpiredBefore(
      harness().clock.now(),
    );

    const allowed = await record();
    const stored = await harness().counter(EMAIL, NOTICE);
    const next: boolean[] = [];
    for (let mail = 0; mail < MAIL_CAP; mail += 1) {
      next.push(await record());
    }

    expect({ removed, allowed, stored, next }).toEqual({
      removed: 1,
      allowed: true,
      stored: {
        email: EMAIL,
        purpose: 'notice',
        mailedCodes: 1,
        windowStartedAt: WINDOW_END,
        expiresAt: SECOND_WINDOW_END,
      },
      next: [true, true, true, true, false],
    });
  });

  it('keeps each purpose and each address on its own counter', async () => {
    await fillCap();

    const otherPurpose = await services.mailCounter.tryRecord(
      EMAIL,
      MAIL_COUNTER_PURPOSE.PASSWORD_RESET,
    );
    const otherAddress = await services.mailCounter.tryRecord(
      'other@example.test',
      NOTICE,
    );

    expect({
      otherPurpose,
      otherAddress,
      same: await record(),
      rows: await harness().counterCount(),
    }).toEqual({
      otherPurpose: true,
      otherAddress: true,
      same: false,
      rows: 3,
    });
  });

  it('refuses a second counter for one address and purpose as a unique conflict', async () => {
    const store = harness().stores.mailCounters;
    const key = { email: EMAIL, purpose: NOTICE };
    const window = { now: TEST_NOW, windowMs: MAIL_WINDOW_MS };
    await store.openCounter(key, window);

    const failure = await rejectionOf(store.openCounter(key, window));

    expect({
      shared: failure instanceof UniqueConflictError,
      constraint:
        failure instanceof UniqueConflictError ? failure.constraint : null,
      expected: MAIL_COUNTER_CONSTRAINT.ADDRESS_PURPOSE,
      rows: await harness().counterCount(),
    }).toEqual({
      shared: true,
      constraint: 'mail_counter.email_purpose',
      expected: 'mail_counter.email_purpose',
      rows: 1,
    });
  });

  it('lets two simultaneous first mails through and counts both', async () => {
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().stores.mailCounters,
      'openCounter',
      () => gate,
    );
    let results: boolean[];
    try {
      const both = [record(), record()];
      await gate.reached(2);
      gate.release();
      results = await Promise.all(both);
    } finally {
      restore();
    }

    expect({
      results,
      stored: (await harness().counter(EMAIL, NOTICE))?.mailedCodes,
      rows: await harness().counterCount(),
    }).toEqual({ results: [true, true], stored: 2, rows: 1 });
  });

  it('admits one of two simultaneous mails at the last free slot', async () => {
    await harness().seedCounter({
      email: EMAIL,
      purpose: NOTICE,
      mailedCodes: MAIL_CAP - 1,
      windowStartedAt: TEST_NOW,
      expiresAt: WINDOW_END,
    });
    const gate = new RaceGate();
    const restore = holdBefore(
      harness().stores.mailCounters,
      'recordWithinCap',
      (call) => (call < 2 ? gate : undefined),
    );
    let results: boolean[];
    try {
      const both = [record(), record()];
      await gate.reached(2);
      gate.release();
      results = await Promise.all(both);
    } finally {
      restore();
    }

    expect({
      admitted: results.filter(Boolean).length,
      stored: (await harness().counter(EMAIL, NOTICE))?.mailedCodes,
    }).toEqual({ admitted: 1, stored: 5 });
  });

  it('removes only the counters whose retention has ended', async () => {
    const cutoff = new Date('2099-01-01T13:00:00.000Z');
    const seed = (email: string, expiresAt: Date) =>
      harness().seedCounter({
        email,
        purpose: NOTICE,
        mailedCodes: 1,
        windowStartedAt: TEST_NOW,
        expiresAt,
      });
    await seed('before@example.test', new Date(cutoff.getTime() - 1));
    await seed('at@example.test', cutoff);
    await seed('after@example.test', new Date(cutoff.getTime() + 1));

    const removed =
      await harness().stores.mailCounters.deleteExpiredBefore(cutoff);

    expect({
      removed,
      before: await harness().counter('before@example.test', NOTICE),
      at: await harness().counter('at@example.test', NOTICE),
      after: (await harness().counter('after@example.test', NOTICE))?.email,
    }).toEqual({
      removed: 2,
      before: null,
      at: null,
      after: 'after@example.test',
    });
  });
}
