import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../../../common/services/clock';
import { UniqueConflictError } from '../../../common/persistence/persistence-errors';
import { PENDING_STORE_PASSES } from '../../constants/pending-store';
import {
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  MAILED_CODE_LIMIT_PER_ADDRESS,
  MailCounterPurpose,
  mailedCodeWindowMs,
} from '../../constants/registration';
import {
  MAIL_RECORD,
  MailCounterStore,
} from '../../pending-codes/mail-counter.store';

/**
 * Caps every per-address mail with its own counter, keyed by address and
 * purpose. The counter is separate from the code record and keeps its own
 * window, so no code record deletion can reset it. The window is derived from
 * the configured code lifetime so no configuration can switch the cap off.
 */
@Injectable()
export class MailCounterService {
  private readonly windowMs: number;

  constructor(
    private readonly store: MailCounterStore,
    private readonly configService: ConfigService,
    private readonly clock: Clock,
  ) {
    this.windowMs = mailedCodeWindowMs(
      this.configService.get<number>(
        'activation.codeExpiresIn',
        ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
      ),
    );
  }

  /** True when this mail is under the cap and may be sent. */
  async tryRecord(
    email: string,
    purpose: MailCounterPurpose,
  ): Promise<boolean> {
    const now = this.clock.now();
    const key = { email, purpose };

    for (let pass = 0; pass < PENDING_STORE_PASSES; pass += 1) {
      const recorded = await this.store.recordWithinCap(key, {
        now,
        windowMs: this.windowMs,
        limit: MAILED_CODE_LIMIT_PER_ADDRESS,
      });
      if (recorded === MAIL_RECORD.RECORDED) {
        return true;
      }

      // A counter that is left is full inside its window.
      if (await this.store.hasCounter(key)) {
        return false;
      }

      try {
        await this.store.openCounter(key, { now, windowMs: this.windowMs });
        return true;
      } catch (error) {
        if (!(error instanceof UniqueConflictError)) throw error;
      }
    }

    return false;
  }
}
