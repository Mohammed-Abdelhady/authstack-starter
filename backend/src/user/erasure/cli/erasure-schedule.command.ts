import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/services/clock';
import { ERASURE_SCHEDULE_BATCH } from '../constants/erasure.constants';
import { ErasureSettings } from '../services/erasure-settings';
import { ErasureJobStore } from '../stores/erasure-job.store';

export interface ErasureScheduleOptions {
  /** When the accounts are erased. Absent: the grace period from now. */
  at?: Date;
}

export interface ErasureScheduleSummary {
  scheduled: number;
  eraseAfter: string;
}

/**
 * Dates the accounts deactivated before erasure was turned on, which a
 * deletion never scheduled. The owner runs it when they decide; nothing runs
 * it by itself.
 */
@Injectable()
export class ErasureScheduleCommand {
  constructor(
    private readonly jobs: ErasureJobStore,
    private readonly settings: ErasureSettings,
    private readonly clock: Clock,
  ) {}

  /** @throws Error while ACCOUNT_ERASE_GRACE_DAYS is not set */
  async schedule(
    options: ErasureScheduleOptions,
  ): Promise<ErasureScheduleSummary> {
    const eraseAfter = options.at ?? this.settings.eraseAfter(this.clock.now());
    if (!this.settings.enabled() || eraseAfter === null) {
      throw new Error(
        'Erasure is off: set ACCOUNT_ERASE_GRACE_DAYS before scheduling accounts',
      );
    }
    let scheduled = 0;
    for (;;) {
      const dated = await this.jobs.scheduleUnscheduled(
        eraseAfter,
        ERASURE_SCHEDULE_BATCH,
      );
      scheduled += dated;
      if (dated < ERASURE_SCHEDULE_BATCH) break;
    }
    return { scheduled, eraseAfter: eraseAfter.toISOString() };
  }
}

/** `[--at <ISO 8601 time>]` */
export function erasureScheduleArguments(
  args: readonly string[],
): ErasureScheduleOptions {
  if (args.length === 0) return {};
  const [flag, value, ...rest] = args;
  const at = value === undefined ? Number.NaN : Date.parse(value);
  if (flag !== '--at' || rest.length > 0 || Number.isNaN(at)) {
    throw new Error('Usage: erasure:schedule [--at <ISO 8601 time>]');
  }
  return { at: new Date(at) };
}
