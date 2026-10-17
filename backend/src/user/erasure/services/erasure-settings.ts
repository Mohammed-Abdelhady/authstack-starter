import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MS_PER_DAY } from '../constants/erasure.constants';

/** `ACCOUNT_ERASE_GRACE_DAYS`: absent means erasure is off, 0 means at once. */
@Injectable()
export class ErasureSettings {
  constructor(private readonly config: ConfigService) {}

  graceDays(): number | undefined {
    return this.config.get<number>('account.eraseGraceDays');
  }

  enabled(): boolean {
    return this.graceDays() !== undefined;
  }

  /** When an account deleted at `deletedAt` is erased, or null while off. */
  eraseAfter(deletedAt: Date): Date | null {
    const days = this.graceDays();
    return days === undefined
      ? null
      : new Date(deletedAt.getTime() + days * MS_PER_DAY);
  }
}
