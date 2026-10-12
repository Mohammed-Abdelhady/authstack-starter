import { Logger } from '@nestjs/common';
import { HandTimers } from './hand-timers.harness-spec';
import { OwnedSchedule } from './owned-schedule';

/** Work that stays in flight until the test lets it finish. */
function heldWork(): {
  work: () => Promise<void>;
  started: () => number;
  finish: () => void;
} {
  let started = 0;
  let release: (() => void) | undefined;
  return {
    work: () => {
      started += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    started: () => started,
    finish: () => release?.(),
  };
}

describe('OwnedSchedule', () => {
  let errors: jest.SpyInstance;

  beforeEach(() => {
    errors = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs nothing until it is started, and sets one timer however often it is started', () => {
    const timers = new HandTimers();
    let runs = 0;
    const schedule = new OwnedSchedule(
      'Test',
      5000,
      () => {
        runs += 1;
        return Promise.resolve();
      },
      timers,
    );

    const beforeStart = runs;
    schedule.start();
    schedule.start();

    expect({ beforeStart, intervals: timers.intervals }).toEqual({
      beforeStart: 0,
      intervals: [5000],
    });
  });

  it('joins the run in flight instead of starting a second one', async () => {
    const timers = new HandTimers();
    const held = heldWork();
    const schedule = new OwnedSchedule('Test', 1000, held.work, timers);
    schedule.start();

    timers.tick();
    timers.tick();
    const joined = schedule.runOnce();
    const whileHeld = held.started();
    held.finish();
    await joined;
    timers.tick();
    const afterNextTick = held.started();
    held.finish();
    await schedule.stop();

    expect({ whileHeld, afterNextTick }).toEqual({
      whileHeld: 1,
      afterNextTick: 2,
    });
  });

  it('waits for the run in flight when it stops, and runs nothing afterwards', async () => {
    const timers = new HandTimers();
    const held = heldWork();
    const schedule = new OwnedSchedule('Test', 1000, held.work, timers);
    schedule.start();
    timers.tick();

    let stopped = false;
    const stopping = schedule.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    const stoppedWhileRunning = stopped;
    held.finish();
    await stopping;
    timers.tick();
    await schedule.runOnce();
    schedule.start();

    expect({
      stoppedWhileRunning,
      stopped,
      started: held.started(),
      cancelled: timers.cancelled,
      intervals: timers.intervals,
    }).toEqual({
      stoppedWhileRunning: false,
      stopped: true,
      started: 1,
      cancelled: 1,
      intervals: [1000],
    });
  });

  it('logs a failed run without its rejection escaping, and runs again on the next tick', async () => {
    const timers = new HandTimers();
    let runs = 0;
    const schedule = new OwnedSchedule(
      'Test',
      1000,
      () => {
        runs += 1;
        return runs === 1
          ? Promise.reject(new Error('the server went away'))
          : Promise.resolve();
      },
      timers,
    );
    schedule.start();

    timers.tick();
    await schedule.runOnce();
    timers.tick();
    await schedule.stop();

    expect({
      runs,
      logged: errors.mock.calls.map(([line]) => String(line)),
    }).toEqual({
      runs: 2,
      logged: ['Scheduled run failed: the server went away'],
    });
  });

  it('stops within its bound when the run in flight never settles, and says so', async () => {
    const timers = new HandTimers();
    const warnings = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const schedule = new OwnedSchedule(
      'Test',
      1000,
      () => new Promise<void>(() => {}),
      timers,
    );
    schedule.start();
    timers.tick();

    let stopped = false;
    const stopping = schedule.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    const beforeTheBound = stopped;
    timers.passDelays();
    await stopping;

    expect({
      beforeTheBound,
      stopped,
      waited: timers.delays,
      said: warnings.mock.calls.map(([line]) => String(line)),
    }).toEqual({
      beforeTheBound: false,
      stopped: true,
      waited: [5000],
      said: [
        'Stopped without waiting further for a run still in flight after 5000 ms',
      ],
    });
  });

  it('asks for no delay when nothing is in flight at the stop', async () => {
    const timers = new HandTimers();
    const schedule = new OwnedSchedule(
      'Test',
      1000,
      () => Promise.resolve(),
      timers,
    );
    schedule.start();

    await schedule.stop();

    expect(timers.delays).toEqual([]);
  });
});
