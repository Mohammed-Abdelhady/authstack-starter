import { TEST_NOW } from '../../../../test/utils/frozen-clock';
import { Statements } from '../../../../test/utils/auth/store-outage-cases';
import { MagicLinkAccounts } from '../stores/magic-link-accounts';
import { MagicLinkStore } from '../stores/magic-link.store';

const UNAVAILABLE = 'PersistenceUnavailableError';
const EMAIL = 'outage@example.test';
const HOUR_MS = 3_600_000;

/** Every link and account method that is one statement committing by itself. */
export function magicLinkStatements(
  links: MagicLinkStore,
  accounts: MagicLinkAccounts,
): Statements {
  return {
    'link.takeRequestSlot': () =>
      links.takeRequestSlot(EMAIL, {
        now: TEST_NOW,
        windowMs: HOUR_MS,
        limit: 5,
      }),
    'link.insertLink': () =>
      links.insertLink({
        email: EMAIL,
        tokenHash: 'hash',
        expiresAt: TEST_NOW,
      }),
    'link.findUnspentLink': () => links.findUnspentLink('hash'),
    'link.claimLink': () => links.claimLink('hash', TEST_NOW),
    'link.restoreUnspentLink': () => links.restoreUnspentLink('hash', TEST_NOW),
    'account.findByEmail': () => accounts.findByEmail(EMAIL),
    'account.findLinkRecipient': () => accounts.findLinkRecipient(EMAIL),
  };
}

/** What every one of those statements raises while the database is away. */
export const MAGIC_LINK_OUTAGES: Record<string, string> = {
  'link.takeRequestSlot': UNAVAILABLE,
  'link.insertLink': UNAVAILABLE,
  'link.findUnspentLink': UNAVAILABLE,
  'link.claimLink': UNAVAILABLE,
  'link.restoreUnspentLink': UNAVAILABLE,
  'account.findByEmail': UNAVAILABLE,
  'account.findLinkRecipient': UNAVAILABLE,
};
