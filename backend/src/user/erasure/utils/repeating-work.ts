import { Logger } from '@nestjs/common';

/** How long stopping waits for a run in flight before shutdown goes on. */
export const REPEATING_WORK_STOP_WAIT_MS = 5_000;

export interface RepeatingTimers {
  every(intervalMs: number, run: () => void): () => void;
  after(delayMs: number, run: () => void): () => void;
}

/** Timers that never keep the process alive by themselves. */
export const UNREF_TIMERS: RepeatingTimers = {
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

interface RepeatingWorkOptions {
  readonly name: string;
  readonly intervalMs: number;
  readonly work: () => Promise<void>;
  readonly timers?: RepeatingTimers;
}

export class RepeatingWork {
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly work: () => Promise<void>;
  private readonly timers: RepeatingTimers;
  private cancel: (() => void) | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor({
    name,
    intervalMs,
    work,
    timers = UNREF_TIMERS,
  }: RepeatingWorkOptions) {
    this.intervalMs = intervalMs;
    this.work = work;
    this.timers = timers;
    this.logger = new Logger(name);
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  start(): void {
    if (this.cancel || this.stopped) return;
    this.cancel = this.timers.every(this.intervalMs, () => {
      void this.runOnce();
    });
  }

  /** Runs now, or joins the run already going. Never rejects. */
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
    const running = this.running;
    if (!running) return;
    await new Promise<void>((resolve) => {
      const cancelWait = this.timers.after(
        REPEATING_WORK_STOP_WAIT_MS,
        resolve,
      );
      void running.finally(() => {
        cancelWait();
        resolve();
      });
    });
  }

  private async guarded(): Promise<void> {
    try {
      await this.work();
    } catch (error) {
      // The name only: a message could carry what a failing call was given.
      this.logger.error(
        `Scheduled run failed: ${error instanceof Error ? error.name : typeof error}`,
      );
    }
  }
}
