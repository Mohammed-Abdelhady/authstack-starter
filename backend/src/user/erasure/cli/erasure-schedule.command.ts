import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/services/clock';
import { ERASURE_SCHEDULE_BATCH } from '../constants/erasure.constants';
import { ErasureSettings } from '../services/erasure-settings';
import { ErasureJobStore } from '../stores/erasure-job.store';

export interface ErasureScheduleOptions {
  /** When the accounts are erased. Absent: the grace period from now. */
  at?: Date;
  /**
   * Also the accounts deactivated before this time that carry no mark of the
   * person's own deletion. Staff deactivations of that time are among them.
   */
  deletedBefore?: Date;
}

export interface ErasureScheduleSummary {
  scheduled: number;
  eraseAfter: string;
  deletedBefore?: string;
}

const USAGE =
  'Usage: erasure:schedule [--at <ISO 8601 time>] [--deleted-before <ISO 8601 time>]';

/**
 * Dates the accounts their owners deleted while erasure was off, which a
 * deletion never scheduled; a staff deactivation is never one of them. The
 * owner runs it when they decide; nothing runs it by itself.
 */
@Injectable()
export class ErasureScheduleCommand {
  constructor(
    private readonly jobs: ErasureJobStore,
    private readonly settings: ErasureSettings,
    private readonly clock: Clock,
  ) {}

  /**
   * @throws Error while ACCOUNT_ERASE_GRACE_DAYS is not set, or for a
   *   `deletedBefore` later than now
   */
  async schedule(
    options: ErasureScheduleOptions,
  ): Promise<ErasureScheduleSummary> {
    const now = this.clock.now();
    const eraseAfter = options.at ?? this.settings.eraseAfter(now);
    if (!this.settings.enabled() || eraseAfter === null) {
      throw new Error(
        'Erasure is off: set ACCOUNT_ERASE_GRACE_DAYS before scheduling accounts',
      );
    }
    const { deletedBefore } = options;
    if (deletedBefore && deletedBefore > now) {
      throw new Error('--deleted-before must not be later than now');
    }
    const selection = { eraseAfter, ...(deletedBefore && { deletedBefore }) };
    let scheduled = 0;
    for (;;) {
      const dated = await this.jobs.scheduleUnscheduled(
        selection,
        ERASURE_SCHEDULE_BATCH,
      );
      scheduled += dated;
      if (dated < ERASURE_SCHEDULE_BATCH) break;
    }
    return {
      scheduled,
      eraseAfter: eraseAfter.toISOString(),
      ...(deletedBefore && { deletedBefore: deletedBefore.toISOString() }),
    };
  }
}

function optionOf(
  flag: string | undefined,
): keyof ErasureScheduleOptions | undefined {
  if (flag === '--at') return 'at';
  if (flag === '--deleted-before') return 'deletedBefore';
  return undefined;
}

/** `[--at <ISO 8601 time>] [--deleted-before <ISO 8601 time>]`, each once. */
export function erasureScheduleArguments(
  args: readonly string[],
): ErasureScheduleOptions {
  const options: ErasureScheduleOptions = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = optionOf(args[index]);
    const value = args[index + 1];
    const time = value === undefined ? Number.NaN : Date.parse(value);
    if (!option || options[option] || Number.isNaN(time)) {
      throw new Error(USAGE);
    }
    options[option] = new Date(time);
  }
  return options;
}
