import { Logger } from '@nestjs/common';

/** Timers as the schedules use them. Each answers with what cancels it. */
export interface ScheduleTimers {
  /** Starts a repeating timer. */
  every(intervalMs: number, run: () => void): () => void;
  /** Runs once after the delay, unless it is cancelled first. */
  after(delayMs: number, run: () => void): () => void;
}

/** Timers that never keep the process alive by themselves. */
export const NODE_TIMERS: ScheduleTimers = {
  every(intervalMs, run) {
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  },
  after(delayMs, run) {
    const timer = setTimeout(run, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

/**
 * How long stopping waits for a run in flight. A statement that hangs on a
 * host that went silent must not hold the shutdown of the server, and five
 * seconds is longer than any healthy run of the work scheduled here.
 */
export const SCHEDULE_STOP_WAIT_MS = 5_000;

/**
 * Settles with `work`, or with `late` when the delay passes first. The work is
 * not cancelled: what it does afterwards is the caller's to ignore.
 */
export function withinDelay<Result>(
  work: Promise<Result>,
  delayMs: number,
  late: () => Result,
  timers: ScheduleTimers,
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    const cancel = timers.after(delayMs, () => resolve(late()));
    work.then(
      (result) => {
        cancel();
        resolve(result);
      },
      (error: unknown) => {
        cancel();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * One piece of repeating work with one owner. A tick that arrives while a run
 * is still going joins that run, so two never overlap and nothing queues up.
 * A failed run is logged and the next tick tries again. `stop` ends the timer
 * and waits for the run in flight, for at most `SCHEDULE_STOP_WAIT_MS`. Nothing
 * runs after it.
 */
export class OwnedSchedule {
  private readonly logger: Logger;
  private cancel: (() => void) | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    name: string,
    private readonly intervalMs: number,
    private readonly work: () => Promise<void>,
    private readonly timers: ScheduleTimers = NODE_TIMERS,
  ) {
    this.logger = new Logger(name);
  }

  /** True once `stop` was called, for work that can end early. */
  get isStopped(): boolean {
    return this.stopped;
  }

  start(): void {
    if (this.cancel || this.stopped) return;
    this.cancel = this.timers.every(this.intervalMs, () => {
      void this.runOnce();
    });
  }

  /** Runs the work now, or joins the run already going. Never rejects. */
  runOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running ??= this.guarded().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.cancel?.();
    this.cancel = undefined;
    if (!this.running) return;
    const finished = await withinDelay(
      this.running.then(() => true),
      SCHEDULE_STOP_WAIT_MS,
      () => false,
      this.timers,
    );
    if (!finished) {
      this.logger.warn(
        `Stopped without waiting further for a run still in flight after ${SCHEDULE_STOP_WAIT_MS} ms`,
      );
    }
  }

  private async guarded(): Promise<void> {
    try {
      await this.work();
    } catch (error) {
      this.logger.error(
        `Scheduled run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
