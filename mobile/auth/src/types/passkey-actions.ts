import type { MessageResult, PasskeyList, PasskeySummary } from '@app/sdk';
import type { PASSKEY_REGISTER_OUTCOME } from '../constants/passkeys';

type Outcome = typeof PASSKEY_REGISTER_OUTCOME;

export type PasskeyRegisterOutcome =
  | { kind: Outcome['CREATED']; passkey: PasskeySummary }
  | { kind: Outcome['CANCELLED'] }
  | { kind: Outcome['NOT_SUPPORTED'] }
  | { kind: Outcome['SIGN_IN_AGAIN'] }
  | { kind: Outcome['ALREADY_REGISTERED'] }
  | { kind: Outcome['FAILED'] };

/**
 * The passkeys of the signed-in account. `available` answers whether this
 * device can make a passkey; whether the account has one comes from `list`.
 * `list`, `rename` and `remove` reject with the SDK's errors.
 */
export interface PasskeyActions {
  /** Proves the current native session. False leaves the original action pending. */
  prove?(): Promise<boolean>;
  available(): Promise<boolean>;
  /**
   * Options, the system prompt, then verify. A call while one is running
   * answers with that one's outcome and opens no second prompt.
   */
  register(name?: string): Promise<PasskeyRegisterOutcome>;
  list(): Promise<PasskeyList>;
  rename(passkeyId: string, name: string): Promise<PasskeySummary>;
  remove(passkeyId: string): Promise<MessageResult>;
}
