import { Injectable } from '@nestjs/common';
import { storedAddress } from '../../../common/persistence/stored-address';
import { Clock } from '../../../common/services/clock';
import {
  EMAIL_CODE_PURPOSE,
  EmailCodeKey,
  EmailCodeStore,
} from '../../pending-codes/email-code.store';
import { reviewDay } from './email-code-review';

/**
 * Wrong guesses at live codes for one address in one UTC day, after which the
 * address is mailed no code until the next day (NIST SP 800-63B 5.2.2).
 */
export const ADDRESS_GUESS_CEILING = 100;

function addressGuessKey(address: string, day: string): EmailCodeKey {
  return {
    ownerId: `${storedAddress(address)}/${day}`,
    purpose: EMAIL_CODE_PURPOSE.ADDRESS_GUESSES,
  };
}

/**
 * Counts wrong guesses at live codes per address and UTC day, from any
 * attempt. At the ceiling no new code is mailed to the address that day.
 * Codes already mailed keep working, and the account is never locked.
 */
@Injectable()
export class NativeEmailCodeCeilingService {
  constructor(
    private readonly codes: EmailCodeStore,
    private readonly clock: Clock,
  ) {}

  async countWrongGuess(address: string): Promise<void> {
    const day = reviewDay(this.clock.now());
    const key = addressGuessKey(address, day.key);
    if (!(await this.codes.find(key))) {
      // Stored spent with no code: the row only counts guesses.
      await this.codes.put({
        ...key,
        email: address,
        codeHash: '',
        expiresAt: day.ends,
        purgeAfter: day.ends,
        spent: true,
      });
    }
    await this.codes.recordWrongGuess(key, ADDRESS_GUESS_CEILING);
  }

  async reachedFor(address: string): Promise<boolean> {
    const day = reviewDay(this.clock.now());
    const guesses = await this.codes.find(addressGuessKey(address, day.key));
    return (guesses?.wrongGuesses ?? 0) >= ADDRESS_GUESS_CEILING;
  }
}
