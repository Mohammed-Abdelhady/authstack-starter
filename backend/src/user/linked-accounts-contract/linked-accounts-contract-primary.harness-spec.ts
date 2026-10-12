import { AppException } from '../../common/exceptions/app.exception';
import {
  LinkedHarnessSource,
  linkedServicesOn,
  profileOf,
} from './linked-accounts-contract.harness-spec';

const CHOSEN = 'chosen';
const NO_PROFILE = 'VALIDATION_ERROR 400';
const NOT_LINKED = 'PROVIDER_NOT_LINKED 400';

interface PrimaryAccount {
  /** A provider created the account, so it does not sign in by email. */
  madeByProvider?: boolean;
  providers: string[];
  /** Asked in this order, each after the hints were read. */
  choices: string[];
}

interface Observed {
  hints: Record<string, string>;
  answers: Record<string, string>;
  /** The primary stored once every choice was answered. */
  stored: string | null;
}

/** Written out by hand: what the page is told, and what each choice answers. */
const ACCOUNTS: Record<string, PrimaryAccount & { expected: Observed }> = {
  'email with two providers': {
    providers: ['google', 'github'],
    choices: ['email', 'github'],
    expected: {
      hints: {
        email: 'no_profile_to_sync',
        google: 'allowed',
        github: 'allowed',
      },
      answers: { email: NO_PROFILE, github: CHOSEN },
      stored: 'github',
    },
  },
  'the provider that is primary already': {
    providers: ['google'],
    choices: ['google'],
    expected: {
      hints: { email: 'no_profile_to_sync', google: 'allowed' },
      answers: { google: CHOSEN },
      stored: 'google',
    },
  },
  'a provider account': {
    madeByProvider: true,
    providers: ['google', 'github'],
    choices: ['email', 'gitlab'],
    expected: {
      hints: { google: 'allowed', github: 'allowed' },
      answers: { email: NO_PROFILE, gitlab: NOT_LINKED },
      stored: 'google',
    },
  },
  'email alone': {
    providers: [],
    choices: ['email', 'google'],
    expected: {
      hints: { email: 'no_profile_to_sync' },
      answers: { email: NO_PROFILE, google: NOT_LINKED },
      stored: null,
    },
  },
};

async function answerOf(choice: Promise<unknown>): Promise<string> {
  try {
    await choice;
  } catch (error) {
    if (error instanceof AppException) {
      return `${error.code} ${error.getStatus()}`;
    }
    throw error;
  }
  return CHOSEN;
}

/** The hint a page reads says what choosing a primary would answer. */
export function primaryHintCases(harness: LinkedHarnessSource): void {
  it('tells the page a sign-in method can be primary exactly when choosing it would go through', async () => {
    const observed: Record<string, Observed> = {};
    for (const [name, account] of Object.entries(ACCOUNTS)) {
      const email = `${name.replaceAll(' ', '-')}@example.test`;
      const userId = await harness().seedAccount({ email, role: 'user' });
      const { linking } = linkedServicesOn(harness());
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
      const hints = linking.primaryHints(
        await linking.getLinkedProviders(userId),
      );
      const answers: Record<string, string> = {};
      for (const choice of account.choices) {
        answers[choice] = await answerOf(
          linking.setPrimaryProvider(userId, choice),
        );
      }
      observed[name] = {
        hints,
        answers,
        stored: (await harness().syncFacts(userId))?.primaryProvider ?? null,
      };
    }

    for (const [name, seen] of Object.entries(observed)) {
      for (const [choice, answer] of Object.entries(seen.answers)) {
        expect({
          name,
          choice,
          hinted: seen.hints[choice] === 'allowed',
        }).toEqual({ name, choice, hinted: answer === CHOSEN });
      }
    }
    expect(observed).toEqual(
      Object.fromEntries(
        Object.entries(ACCOUNTS).map(([name, { expected }]) => [
          name,
          expected,
        ]),
      ),
    );
  });
}
