import { ScheduleTimers } from './owned-schedule';

/**
 * Timers a spec fires by hand, so nothing waits on real time. It records the
 * intervals and delays asked of it.
 */
export class HandTimers implements ScheduleTimers {
  readonly intervals: number[] = [];
  readonly delays: number[] = [];
  cancelled = 0;
  private run: (() => void) | undefined;
  private deadlines: Array<() => void> = [];

  every(intervalMs: number, run: () => void): () => void {
    this.intervals.push(intervalMs);
    this.run = run;
    return () => {
      this.cancelled += 1;
      this.run = undefined;
    };
  }

  after(delayMs: number, run: () => void): () => void {
    this.delays.push(delayMs);
    this.deadlines.push(run);
    return () => {
      this.deadlines = this.deadlines.filter((pending) => pending !== run);
    };
  }

  /** Fires the repeating timer once, if it is still set. */
  tick(): void {
    this.run?.();
  }

  /** Lets every pending delay pass. */
  passDelays(): void {
    const due = this.deadlines;
    this.deadlines = [];
    for (const run of due) run();
  }
}
