import { AppException } from '../../common/exceptions/app.exception';
import {
  linkedCase,
  LinkedHarnessSource,
  linkedServicesOn,
  profileOf,
  SignInSwitchesOf,
} from './linked-accounts-contract.harness-spec';

const UNLINKED = 'unlinked';
const LAST_PROVIDER = 'CANNOT_UNLINK_LAST_PROVIDER 400';
const NOT_A_LINK = 'VALIDATION_ERROR 400'; // feature:email-password,magic-link
const NOTHING_BY_EMAIL: SignInSwitchesOf = {
  password: false,
  magicLink: false,
};

interface HintedAccount {
  /** A provider created the account, so it does not sign in by email. */
  madeByProvider?: boolean;
  passwordHash?: string;
  providers: string[];
  switches: SignInSwitchesOf;
  unlink: string;
}

interface Observed {
  hints: Record<string, string>;
  canUnlink: boolean;
  answer: string;
  /** The providers stored once the unlink was answered. */
  stored: string[];
}

/** Written out by hand: what the page is told, and what the unlink answers. */
const ACCOUNTS: Record<string, HintedAccount & { expected: Observed }> = {
  'nothing by email': {
    providers: ['google'],
    switches: NOTHING_BY_EMAIL,
    unlink: 'google',
    expected: {
      hints: { email: 'not_removable', google: 'last_sign_in_method' },
      canUnlink: false,
      answer: LAST_PROVIDER,
      stored: ['google'],
    },
  },
  'a password that cannot be used': {
    passwordHash: 'stored-hash',
    providers: ['google'],
    switches: NOTHING_BY_EMAIL,
    unlink: 'google',
    expected: {
      hints: { email: 'not_removable', google: 'last_sign_in_method' },
      canUnlink: false,
      answer: LAST_PROVIDER,
      stored: ['google'],
    },
  },
  // feature:email-password:start
  'password reset by email': {
    providers: ['google'],
    switches: { password: true, magicLink: false },
    unlink: 'google',
    expected: {
      hints: { email: 'not_removable', google: 'allowed' },
      canUnlink: true,
      answer: UNLINKED,
      stored: [],
    },
  },
  // feature:email-password:end
  // feature:magic-link:start
  'magic links': {
    providers: ['google'],
    switches: { password: false, magicLink: true },
    unlink: 'google',
    expected: {
      hints: { email: 'not_removable', google: 'allowed' },
      canUnlink: true,
      answer: UNLINKED,
      stored: [],
    },
  },
  // feature:magic-link:end
  'a second provider': {
    providers: ['google', 'github'],
    switches: NOTHING_BY_EMAIL,
    unlink: 'github',
    expected: {
      hints: { email: 'not_removable', google: 'allowed', github: 'allowed' },
      canUnlink: true,
      answer: UNLINKED,
      stored: ['google'],
    },
  },
  'a provider account': {
    madeByProvider: true,
    passwordHash: 'stored-hash',
    providers: ['google'],
    switches: { password: true, magicLink: true },
    unlink: 'google',
    expected: {
      hints: { google: 'last_sign_in_method' },
      canUnlink: false,
      answer: LAST_PROVIDER,
      stored: ['google'],
    },
  },
  'a provider account with two': {
    madeByProvider: true,
    providers: ['google', 'github'],
    switches: NOTHING_BY_EMAIL,
    unlink: 'google',
    expected: {
      hints: { google: 'allowed', github: 'allowed' },
      canUnlink: true,
      answer: UNLINKED,
      stored: ['github'],
    },
  },
  // feature:email-password,magic-link:start
  'email sign-in itself': {
    providers: ['google'],
    switches: { password: true, magicLink: true },
    unlink: 'email',
    expected: {
      hints: { email: 'not_removable', google: 'allowed' },
      canUnlink: false,
      answer: NOT_A_LINK,
      stored: ['google'],
    },
  },
  // feature:email-password,magic-link:end
};

async function answerOf(unlink: Promise<unknown>): Promise<string> {
  try {
    await unlink;
  } catch (error) {
    if (error instanceof AppException) {
      return `${error.code} ${error.getStatus()}`;
    }
    throw error;
  }
  return UNLINKED;
}

/** The hint a page reads says what the unlink would answer. */
export function unlinkHintCases(harness: LinkedHarnessSource): void {
  linkedCase(
    'tells the page an unlink is allowed exactly when the unlink would go through',
    async () => {
      const observed: Record<string, Observed> = {};
      for (const [name, account] of Object.entries(ACCOUNTS)) {
        const email = `${name.replaceAll(' ', '-')}@example.test`;
        const userId = await harness().seedAccount({
          email,
          role: 'user',
          passwordHash: account.passwordHash,
        });
        const { linking } = linkedServicesOn(
          harness(),
          undefined,
          account.switches,
        );
        for (const provider of account.providers) {
          await linking.linkProvider(
            userId,
            provider,
            profileOf(`${provider}-${name}`, { email }),
          );
        }
        if (account.madeByProvider) {
          await harness().setAuthProvider(userId, account.providers[0]);
        }

        // Asked first, the way a page reads it before it offers the action.
        const hints = await linking.unlinkHints(
          userId,
          await linking.getLinkedProviders(userId),
        );
        const canUnlink = await linking.canUnlinkProvider(
          userId,
          account.unlink,
        );
        const answer = await answerOf(
          linking.unlinkProvider(userId, account.unlink),
        );
        observed[name] = {
          hints,
          canUnlink,
          answer,
          stored: (await harness().storedLinks(userId)).map(
            (link) => link.provider,
          ),
        };
      }

      for (const [name, seen] of Object.entries(observed)) {
        const hinted = seen.hints[ACCOUNTS[name].unlink] === 'allowed';
        expect({ name, hinted, canUnlink: seen.canUnlink }).toEqual({
          name,
          hinted: seen.answer === UNLINKED,
          canUnlink: seen.answer === UNLINKED,
        });
      }
      expect(observed).toEqual(
        Object.fromEntries(
          Object.entries(ACCOUNTS).map(([name, { expected }]) => [
            name,
            expected,
          ]),
        ),
      );
    },
  );
}
