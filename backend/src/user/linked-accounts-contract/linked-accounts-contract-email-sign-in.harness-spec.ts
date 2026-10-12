import { AppException } from '../../common/exceptions/app.exception';
import {
  LinkedHarnessSource,
  linkedServicesOn,
  profileOf,
  SignInSwitchesOf,
} from './linked-accounts-contract.harness-spec';

const UNLINKED = 'unlinked';
const LAST_PROVIDER = 'CANNOT_UNLINK_LAST_PROVIDER 400';

interface EmailAccount {
  /** A provider created the account, so it does not sign in by email. */
  madeByProvider?: boolean;
  passwordHash?: string;
  /** Google is linked, and the case then tries to unlink it. */
  linksGoogle: boolean;
  switches: SignInSwitchesOf;
}

interface Observed {
  providers: string[];
  /** Null stands for a field the answer does not carry. */
  emailSignIn: string | null;
  unlinkHints: Record<string, string>;
  /** What unlinking Google answered, when Google was linked. */
  unlinkGoogle: string | null;
}

/** Written out by hand: what the page is told, and what the rule then does. */
const ACCOUNTS: Record<string, EmailAccount & { expected: Observed }> = {
  'both switched off': {
    linksGoogle: true,
    switches: { password: false, magicLink: false },
    expected: {
      providers: ['email', 'google'],
      emailSignIn: 'switched_off',
      unlinkHints: { email: 'not_removable', google: 'last_sign_in_method' },
      unlinkGoogle: LAST_PROVIDER,
    },
  },
  'both switched off with a stored password': {
    passwordHash: 'stored-hash',
    linksGoogle: true,
    switches: { password: false, magicLink: false },
    expected: {
      providers: ['email', 'google'],
      emailSignIn: 'switched_off',
      unlinkHints: { email: 'not_removable', google: 'last_sign_in_method' },
      unlinkGoogle: LAST_PROVIDER,
    },
  },
  // feature:email-password:start
  'password sign-in only': {
    linksGoogle: true,
    switches: { password: true, magicLink: false },
    expected: {
      providers: ['email', 'google'],
      emailSignIn: 'usable',
      unlinkHints: { email: 'not_removable', google: 'allowed' },
      unlinkGoogle: UNLINKED,
    },
  },
  // feature:email-password:end
  // feature:magic-link:start
  'magic links only': {
    linksGoogle: true,
    switches: { password: false, magicLink: true },
    expected: {
      providers: ['email', 'google'],
      emailSignIn: 'usable',
      unlinkHints: { email: 'not_removable', google: 'allowed' },
      unlinkGoogle: UNLINKED,
    },
  },
  // feature:magic-link:end
  // feature:email-password,magic-link:start
  'both switched on': {
    linksGoogle: true,
    switches: { password: true, magicLink: true },
    expected: {
      providers: ['email', 'google'],
      emailSignIn: 'usable',
      unlinkHints: { email: 'not_removable', google: 'allowed' },
      unlinkGoogle: UNLINKED,
    },
  },
  // feature:email-password,magic-link:end
  'email alone and both switched off': {
    linksGoogle: false,
    switches: { password: false, magicLink: false },
    expected: {
      providers: ['email'],
      emailSignIn: 'switched_off',
      unlinkHints: { email: 'not_removable' },
      unlinkGoogle: null,
    },
  },
  'a provider account': {
    madeByProvider: true,
    passwordHash: 'stored-hash',
    linksGoogle: true,
    switches: { password: true, magicLink: true },
    expected: {
      providers: ['google'],
      emailSignIn: null,
      unlinkHints: { google: 'last_sign_in_method' },
      unlinkGoogle: LAST_PROVIDER,
    },
  },
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

/** The page is told email sign-in is usable when the rule counts it. */
export function emailSignInHintCases(harness: LinkedHarnessSource): void {
  it('tells the page email sign-in is usable exactly when the rule counts it as a way in', async () => {
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
      if (account.linksGoogle) {
        await linking.linkProvider(
          userId,
          'google',
          profileOf(`google-${name}`, { email }),
        );
      }
      if (account.madeByProvider) {
        await harness().setAuthProvider(userId, 'google');
      }

      // Asked first, the way a page reads it before it shows the row.
      const providers = await linking.getLinkedProviders(userId);
      const told = await linking.signInMethodHints(userId, providers);
      observed[name] = {
        providers,
        emailSignIn: told.emailSignIn ?? null,
        unlinkHints: told.unlinkHints,
        unlinkGoogle: account.linksGoogle
          ? await answerOf(linking.unlinkProvider(userId, 'google'))
          : null,
      };
    }

    expect(observed).toEqual(
      Object.fromEntries(
        Object.entries(ACCOUNTS).map(([name, { expected }]) => [
          name,
          expected,
        ]),
      ),
    );
    // On an email account whose one provider goes, email is the way left.
    for (const [name, seen] of Object.entries(observed)) {
      if (seen.emailSignIn !== null && seen.unlinkGoogle !== null) {
        expect({ name, usable: seen.emailSignIn === 'usable' }).toEqual({
          name,
          usable: seen.unlinkGoogle === UNLINKED,
        });
      }
    }
  });
}
