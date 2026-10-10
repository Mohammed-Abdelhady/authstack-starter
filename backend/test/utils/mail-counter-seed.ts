import type { Model } from 'mongoose'; // feature:mongodb
import type { MailCounter } from '../../src/auth/persistence/mongo/schemas/mail-counter.schema'; // feature:mongodb
import {
  ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  MailCounterPurpose,
  mailedCodeWindowMs,
} from '../../src/auth/constants/registration';
import { TEST_NOW } from './frozen-clock';

export interface MailCounterSeed {
  email: string;
  purpose: MailCounterPurpose;
  mailedCodes: number;
  /** Defaults to the frozen test clock. */
  windowStartedAt?: Date;
  /** The configured code lifetime the service under test runs with. */
  codeExpiresIn?: number;
}

/** The counter as the service stores one for this seed. */
export function mailCounterRecord(seed: MailCounterSeed) {
  const windowStartedAt = seed.windowStartedAt ?? TEST_NOW;
  const windowMs = mailedCodeWindowMs(
    seed.codeExpiresIn ?? ACTIVATION_CODE_EXPIRES_IN_DEFAULT,
  );
  return {
    email: seed.email,
    purpose: seed.purpose,
    mailedCodes: seed.mailedCodes,
    windowStartedAt,
    expiresAt: new Date(windowStartedAt.getTime() + windowMs),
  };
}

// feature:mongodb:start
/**
 * Seeds a counter the way the service writes one: the expiry is the window
 * start plus the window derived from the code lifetime.
 */
export async function seedMailCounter(
  counters: Model<MailCounter>,
  seed: MailCounterSeed,
): Promise<void> {
  await counters.create(mailCounterRecord(seed));
}
// feature:mongodb:end
