import { HttpException } from '@nestjs/common';
import {
  MAIL_COUNTER_PURPOSE,
  MailCounterPurpose,
  PENDING_PURPOSE,
  PendingPurpose,
} from '../../../../src/auth/constants/registration';
import { holdBefore, RaceGate } from '../../race-gate';
import { PendingCodesContractHarness } from './pending-codes-contract-harness';
import {
  codeOf,
  ContractServices,
  rejectionOf,
  rerunAtOnce,
} from './pending-codes-contract-support';

/** Written out, so a changed constant cannot agree with itself. */
export const GUESS_LIMIT = 5;
export const FIRST_LOCK_MS = 900_000;
export const LONGEST_LOCK_MS = 86_400_000;
export const GUESS_MEMORY_MS = 86_400_000;
/** Never mailed: a mailed code starts at 100000. */
export const WRONG_GUESS = '000000';

export interface Refusal {
  code: string;
  status: number;
  message: string;
}

/** One kind of mailed code, driven through the service that owns it. */
export interface GuessFlow {
  /** Mails the address a new code and answers it. */
  issue(email: string): Promise<string>;
  /** `accepted`, or the error code the guess was refused with. */
  guess(email: string, code: string): Promise<string>;
  refusalOf(email: string, code: string): Promise<Refusal>;
  /** Compares the code and spends it, as the route that uses it does. */
  redeem(email: string, code: string): Promise<boolean>;
  /** Holds calls that count a guess on a gate. Answers the undo. */
  holdGuesses(gateFor: (call: number) => RaceGate | undefined): () => void;
}

export interface GuessFlowDefinition {
  name: string;
  purpose: MailCounterPurpose;
  refusal: string;
  status: number;
  on(
    services: ContractServices,
    harness: PendingCodesContractHarness,
  ): GuessFlow;
}

async function refusal(attempt: Promise<unknown>): Promise<Refusal> {
  const error = await rejectionOf(attempt);
  return {
    code: codeOf(error),
    status: error instanceof HttpException ? error.getStatus() : 0,
    message: error instanceof Error ? error.message : '',
  };
}

async function answerOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
    return 'accepted';
  } catch (error) {
    return codeOf(error);
  }
}

function registrationFlow(
  name: string,
  purpose: PendingPurpose,
): GuessFlowDefinition {
  return {
    name,
    purpose,
    refusal: 'ACTIVATION_CODE_INVALID',
    status: 400,
    on: (services, harness) => {
      const details =
        purpose === PENDING_PURPOSE.EMAIL_CHANGE
          ? { userId: harness.accountId(), addressGeneration: 0 }
          : {};
      const verify = (email: string, code: string) =>
        services.verification.verifyCode(email, code, purpose);
      return {
        issue: async (email) => {
          const issued =
            await services.verification.createOrUpdatePendingRegistration(
              email,
              purpose,
              details,
            );
          if (!issued) {
            throw new Error('the case asked for more mail than the cap allows');
          }
          return issued.code;
        },
        guess: (email, code) => answerOf(verify(email, code)),
        refusalOf: (email, code) => refusal(verify(email, code)),
        redeem: async (email, code) => {
          const reserved = await verify(email, code);
          return harness
            .runner(rerunAtOnce)
            .run((unitOfWork) =>
              services.verification.consumeCode(reserved, unitOfWork),
            );
        },
        holdGuesses: (gateFor) =>
          holdBefore(harness.stores.registrations, 'reserveAttempt', gateFor),
      };
    },
  };
}

const passwordResetFlow: GuessFlowDefinition = {
  name: 'password reset',
  purpose: MAIL_COUNTER_PURPOSE.PASSWORD_RESET,
  refusal: 'PASSWORD_RESET_CODE_INVALID',
  status: 400,
  on: (services, harness) => {
    const verify = (email: string, code: string) =>
      services.passwordReset.verifyPasswordReset(email, code);
    return {
      issue: (email) =>
        services.passwordReset.createOrUpdatePasswordReset(email),
      guess: (email, code) => answerOf(verify(email, code)),
      refusalOf: (email, code) => refusal(verify(email, code)),
      redeem: async (email, code) => {
        const reserved = await verify(email, code);
        return services.passwordReset.consumePasswordReset(
          reserved.id,
          reserved.hashedCode,
        );
      },
      holdGuesses: (gateFor) =>
        holdBefore(harness.stores.passwordResets, 'reserveAttempt', gateFor),
    };
  },
};

export const SIGNUP_FLOW = registrationFlow('sign-up', PENDING_PURPOSE.SIGNUP);
export const EMAIL_CHANGE_FLOW = registrationFlow(
  'email change',
  PENDING_PURPOSE.EMAIL_CHANGE,
);
export const PASSWORD_RESET_FLOW = passwordResetFlow;

export const GUESS_FLOWS: GuessFlowDefinition[] = [
  SIGNUP_FLOW,
  EMAIL_CHANGE_FLOW,
  PASSWORD_RESET_FLOW,
];
