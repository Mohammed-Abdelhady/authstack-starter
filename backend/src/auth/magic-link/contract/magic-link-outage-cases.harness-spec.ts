import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { Statements } from '../../../../test/utils/auth/store-outage-cases';
import { MagicLinkAccounts } from '../stores/magic-link-accounts';
import { MagicLinkStore } from '../stores/magic-link.store';

const UNAVAILABLE = 'PersistenceUnavailableError';
const EMAIL = 'outage@example.test';

/** Every link and account method that is one statement committing by itself. */
export function magicLinkStatements(
  links: MagicLinkStore,
  accounts: MagicLinkAccounts,
): Statements {
  return {
    'link.countRequestedSince': () =>
      links.countRequestedSince(EMAIL, TEST_NOW),
    'link.insertLink': () =>
      links.insertLink({
        email: EMAIL,
        tokenHash: 'hash',
        expiresAt: TEST_NOW,
      }),
    'link.claimLink': () => links.claimLink('hash', TEST_NOW),
    'account.findByEmail': () => accounts.findByEmail(EMAIL),
    'account.createPasswordless': () =>
      accounts.createPasswordless({ email: EMAIL, name: 'Outage Tester' }),
  };
}

/** What every one of those statements raises while the database is away. */
export const MAGIC_LINK_OUTAGES: Record<string, string> = {
  'link.countRequestedSince': UNAVAILABLE,
  'link.insertLink': UNAVAILABLE,
  'link.claimLink': UNAVAILABLE,
  'account.findByEmail': UNAVAILABLE,
  'account.createPasswordless': UNAVAILABLE,
};
