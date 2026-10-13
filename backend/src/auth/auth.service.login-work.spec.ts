import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Response } from 'express';
import { AppException } from '../common/exceptions/app.exception';
import { IdFormat } from '../common/persistence/id-format';
import { HashService } from '../common/services/hash.service';
import {
  createResponseMock,
  partialMock,
} from '../common/testing/test-doubles.harness-spec';
import { StoredAccount } from '../user/stores/stored-account';
import { AuthService } from './auth.service';
import { PasswordResetCodeService } from './services/codes/password-reset-code.service';
import { AuthMailService } from './services/mail/auth-mail.service';
import { MailCounterService } from './services/mail/mail-counter.service';
import { Sessions } from './services/sessions/sessions';
import { SignInCompletion } from './services/sessions/sign-in-completion';
import {
  PasswordCandidate,
  PasswordSignInStore,
} from './stores/password-sign-in.store';

const ROUNDS = 4;
const PASSWORD = 'Password123!';
const WITH_PASSWORD = 'has-password@example.test';
const WITHOUT_PASSWORD = 'no-password@example.test';
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', status: 401 };

function account(id: string, email: string): StoredAccount {
  const at = new Date('2099-01-01T12:00:00.000Z');
  return {
    id,
    email,
    name: 'Work Tester',
    role: 'user',
    permissions: [],
    authProvider: 'email',
    linkedAccounts: [],
    linkedProviders: [],
    isVerified: true,
    isDeleted: false,
    sessionVersion: 0,
    addressGeneration: 0,
    twoFactorEnabled: false, // feature:totp
    createdAt: at,
    updatedAt: at,
  };
}

/** Two accounts by address: one with a password hash and one without. */
class TwoAccounts extends PasswordSignInStore {
  constructor(private readonly passwordHash: string) {
    super();
  }

  findForPasswordCheck(email: string): Promise<PasswordCandidate | null> {
    if (email === WITH_PASSWORD) {
      return Promise.resolve({
        account: account('account-with-password', email),
        passwordHash: this.passwordHash,
      });
    }
    if (email === WITHOUT_PASSWORD) {
      return Promise.resolve({
        account: account('account-without-password', email),
      });
    }
    return Promise.resolve(null);
  }

  findActiveByAddress(): Promise<StoredAccount | null> {
    return Promise.resolve(null);
  }

  storeNewPassword(): Promise<void> {
    return Promise.resolve();
  }

  storeNewPasswordIn(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

const SUMMARY = {
  email: 'signed-in@example.test',
  name: 'Signed In',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: [],
};

async function answerOf(
  attempt: Promise<unknown>,
): Promise<{ code: string; status: number } | 'signed in'> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus() };
    }
    throw error;
  }
  return 'signed in';
}

describe('the hashing work one password sign-in attempt costs', () => {
  let service: AuthService;
  const signedIn: string[] = [];
  let compare: jest.SpyInstance<Promise<boolean>, [string, string]>;
  const response: Response = createResponseMock({});

  beforeAll(async () => {
    const hashService = new HashService(
      new ConfigService({ bcrypt: { rounds: ROUNDS } }),
    );
    // The dummy hash is made once, before any attempt is counted.
    await hashService.spendComparison('warm-up');
    compare = jest.spyOn(hashService, 'compare');
    service = new AuthService(
      new TwoAccounts(await bcrypt.hash(PASSWORD, ROUNDS)),
      partialMock<IdFormat>(),
      hashService,
      partialMock<AuthMailService>(),
      partialMock<Sessions>(),
      partialMock<PasswordResetCodeService>(),
      partialMock<MailCounterService>(),
      // Stands where the shared sign-in stands and records who it signed in.
      partialMock<SignInCompletion>({
        completeSignIn: (user) => {
          signedIn.push(user.id);
          return Promise.resolve({
            requiresTwoFactor: false,
            user: { ...SUMMARY, id: user.id },
          });
        },
      }),
    );
  });

  beforeEach(() => {
    compare.mockClear();
    signedIn.length = 0;
  });

  it.each([
    ['an address with no account', 'nobody@example.test', PASSWORD],
    ['an account without a password', WITHOUT_PASSWORD, PASSWORD],
    ['an account given the wrong password', WITH_PASSWORD, 'NotThePassword1!'],
  ])('refuses %s after exactly one comparison', async (_name, email, sent) => {
    const answer = await answerOf(
      service.login({ email, password: sent }, response),
    );

    expect({
      answer,
      comparisons: compare.mock.calls.length,
      compared: compare.mock.calls.map(([plainText]) => plainText),
      signedIn,
    }).toEqual({
      answer: INVALID_CREDENTIALS,
      comparisons: 1,
      compared: [sent],
      signedIn: [],
    });
  });

  it('signs in an account given its password after exactly one comparison', async () => {
    const answer = await answerOf(
      service.login({ email: WITH_PASSWORD, password: PASSWORD }, response),
    );

    expect({
      answer,
      comparisons: compare.mock.calls.length,
      signedIn,
    }).toEqual({
      answer: 'signed in',
      comparisons: 1,
      signedIn: ['account-with-password'],
    });
  });
});
