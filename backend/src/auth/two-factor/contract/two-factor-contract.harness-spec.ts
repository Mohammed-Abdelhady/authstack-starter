import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { generateSync } from 'otplib';
import { FrozenClock } from '../../../../test/utils/frozen-clock';
import { AppException } from '../../../common/exceptions/app.exception';
import { HashService } from '../../../common/services/hash.service';
import {
  createRequestMock,
  createResponseMock,
} from '../../../common/testing/test-doubles.harness-spec';
import { AuthenticatedUserSummary } from '../../interfaces/authenticated-user.interface';
import { FirstFactor } from '../../services/sessions/first-factor';
import {
  TOTP_DIGITS,
  TOTP_STEP_SECONDS,
} from '../constants/two-factor.constants';
import { SecondFactorVerifier } from '../services/second-factor-verifiers';
import { TotpSecretCryptoService } from '../services/totp-secret-crypto.service';
import { TwoFactorChallengeService } from '../services/two-factor-challenge.service';
import { passwordSwitch } from '../services/password-switch.harness-spec';
import { TwoFactorReauthService } from '../services/two-factor-reauth.service';
import { TwoFactorVerificationService } from '../services/two-factor-verification.service';
import { SecondFactorAccount } from '../stores/second-factor-account';
import { SecondFactorSignIn } from '../stores/second-factor-sign-in';
import { TwoFactorLoginService } from '../two-factor-login.service';
import { TwoFactorService } from '../two-factor.service';

import {
  StoredSecondFactorFacts,
  TwoFactorContractHarness,
} from './two-factor-contract-database.harness-spec';

export * from './two-factor-contract-database.harness-spec';

/** Jest budget for a contract case, the one the sign-in contract established. */
export const TWO_FACTOR_CONTRACT_CASE_TIMEOUT_MS = 60000;

/** Written out, so a changed constant cannot agree with itself. */
export const CHALLENGE_LIFETIME_MS = 300_000;
export const MAX_WRONG_ANSWERS = 5;
export const FRESH_SESSION_MS = 300_000;
export const STEP_MS = 30_000;
/** 2099-01-01T12:00:00Z in TOTP steps: 4070952000 seconds over 30. */
export const STEP_AT_TEST_NOW = 135_698_400;
export const RECOVERY_CODES_PER_BATCH = 10;

export const PASSWORD = 'Password123!';
export const BCRYPT_ROUNDS = 4;
export const TOTP_SECRET = 'NYITGE7DZ7KUSQJFKLHJL2LZ6Z5IDTV7';
export const RECOVERY_CODE = 'K3M7QRTVWX';
export const OTHER_RECOVERY_CODE = 'B2C3D4E5F6';
/** sha256 of the two codes above, hex encoded. */
export const RECOVERY_HASH =
  '9c130e2356b103e3ee27dd5b5a19523020bf885f9885e4e709a8fbc8952801c2';
export const OTHER_RECOVERY_HASH =
  'b1125a71fbd3b7a9ebced8f78796213f8b6ff0a0b6079de51851746662692aae';
export const CHALLENGE_COOKIE = 'mfa_challenge';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

/** A contract case with the budget a database case gets. */
export function twoFactorCase(name: string, body: () => Promise<void>): void {
  it(name, body, TWO_FACTOR_CONTRACT_CASE_TIMEOUT_MS);
}

const SUMMARY = {
  email: 'signed-in@example.test',
  name: 'Signed In',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: [],
};

/**
 * Stands where the shared sign-in stands. Sessions are behind their own
 * stores and have their own contract, so these cases record which account was
 * handed over and how often.
 */
export class RecordingSignIn extends SecondFactorSignIn {
  readonly accountIds: string[] = [];
  /** When set, the next session issue fails with it. */
  failure: Error | undefined;

  issueSession(
    account: SecondFactorAccount,
  ): Promise<AuthenticatedUserSummary> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.accountIds.push(account.id);
    return Promise.resolve({ ...SUMMARY, id: account.id });
  }
}

export interface TwoFactorServices {
  settings: TwoFactorService;
  login: TwoFactorLoginService;
  verification: TwoFactorVerificationService;
  challenge: TwoFactorChallengeService;
  crypto: TotpSecretCryptoService;
  signIn: RecordingSignIn;
  /** Every store call the services made, in order. */
  storeCalls: string[];
}

function recorded<Store extends object>(
  store: Store,
  label: string,
  calls: string[],
): Store {
  return new Proxy(store, {
    get(target, property) {
      const member: unknown = Reflect.get(target, property, target);
      if (typeof member !== 'function' || typeof property !== 'string') {
        return member;
      }
      return (...args: unknown[]): unknown => {
        calls.push(`${label}.${property}`);
        return Reflect.apply(member, target, args);
      };
    },
  });
}

/** The real services on one database's adapters. */
export function twoFactorServices(
  harness: TwoFactorContractHarness,
  verifiers: SecondFactorVerifier[] = [],
): TwoFactorServices {
  const config = new ConfigService({
    twoFactor: { encryptionKey: ENCRYPTION_KEY },
    bcrypt: { rounds: BCRYPT_ROUNDS },
    NODE_ENV: 'test',
  });
  const storeCalls: string[] = [];
  const accounts = recorded(harness.accounts, 'accounts', storeCalls);
  const challenges = recorded(harness.challenges, 'challenges', storeCalls);
  const crypto = new TotpSecretCryptoService(config);
  const verification = new TwoFactorVerificationService(accounts, crypto);
  const challenge = new TwoFactorChallengeService(challenges, config, crypto);
  const signIn = new RecordingSignIn();

  return {
    settings: new TwoFactorService(
      accounts,
      crypto,
      verification,
      new TwoFactorReauthService(new HashService(config), passwordSwitch(true)),
    ),
    login: new TwoFactorLoginService(
      accounts,
      challenge,
      verification,
      signIn,
      verifiers,
    ),
    verification,
    challenge,
    crypto,
    signIn,
    storeCalls,
  };
}

/** The code an authenticator app shows `steps` away from the clock's step. */
export function codeAt(clock: FrozenClock, secret: string, steps = 0): string {
  return generateSync({
    secret,
    epoch: clock.now().getTime() / 1000 + steps * TOTP_STEP_SECONDS,
    period: TOTP_STEP_SECONDS,
    digits: TOTP_DIGITS,
  });
}

/** A code no step of this secret shows around the clock's time. */
export function wrongCode(clock: FrozenClock, secret: string): string {
  const near = [-1, 0, 1].map((steps) => codeAt(clock, secret, steps));
  const candidate = ['000000', '111111', '222222', '333333'].find(
    (code) => !near.includes(code),
  );
  if (!candidate) {
    throw new Error('no wrong code is available');
  }
  return candidate;
}

/** One browser: the cookies it holds, and the request and response using them. */
export interface Browser {
  request: Request;
  response: Response;
  cookies: Record<string, string>;
}

export function browser(cookies: Record<string, string> = {}): Browser {
  const jar = { ...cookies };
  return {
    cookies: jar,
    request: createRequestMock({ cookies: jar }),
    response: createResponseMock({
      cookie: (name: string, value: string): void => {
        jar[name] = value;
      },
      clearCookie: (name: string): void => {
        delete jar[name];
      },
    }),
  };
}

export interface Answer {
  code: string;
  status: number;
}

/** Awaits a promise that must be refused and hands back how. */
export async function refusalOf(promise: Promise<unknown>): Promise<Answer> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus() };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

/** How one attempt ended: accepted, or the code it was refused with. */
export async function outcomeOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof AppException) return error.code;
    throw error;
  }
  return 'accepted';
}

/** Awaits a promise that must reject and hands back what it rejected with. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

export const OWNER_EMAIL = 'owner@example.test';
export const OTHER_EMAIL = 'other@example.test';

export interface TwoFactorFixture {
  /** An account with a password and no second factor. */
  ownerId: string;
  /** A second account, also without one. */
  otherId: string;
}

/** The state of an account that never started setup. */
export const NO_SECOND_FACTOR: StoredSecondFactorFacts = {
  enabled: false,
  secret: null,
  confirmedAt: null,
  recoveryCodes: [],
  lastUsedStep: null,
};

/** Turns the factor on around the adapters, with two unspent recovery codes. */
export async function seedEnabled(
  harness: TwoFactorContractHarness,
  crypto: TotpSecretCryptoService,
  userId: string,
  overrides: Partial<StoredSecondFactorFacts> = {},
): Promise<void> {
  await harness.seedSecondFactor(userId, {
    enabled: true,
    secret: crypto.encrypt(TOTP_SECRET),
    confirmedAt: harness.clock.now(),
    recoveryCodes: [
      { hash: RECOVERY_HASH, usedAt: null },
      { hash: OTHER_RECOVERY_HASH, usedAt: null },
    ],
    lastUsedStep: null,
    ...overrides,
  });
}

/** Opens a challenge the way a first factor does and hands back its browser. */
export async function challengedBrowser(
  services: TwoFactorServices,
  userId: string,
  firstFactor: FirstFactor = 'password',
): Promise<Browser> {
  const holder = browser();
  await services.challenge.issue(userId, holder.response, firstFactor);
  return holder;
}
