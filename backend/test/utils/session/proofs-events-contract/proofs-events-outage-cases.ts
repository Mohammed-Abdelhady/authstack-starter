import { SecurityEventStore } from '../../../../src/session/events/security-event.store';
import { BrowserProofStore } from '../../../../src/session/proofs/browser-proof.store';
import { Statements } from '../../auth/store-outage-cases';
import { TEST_NOW } from '../../frozen-clock';

const UNAVAILABLE = 'PersistenceUnavailableError';
const HASH = 'a'.repeat(64);

/** Every proof and event method that is one statement committing by itself. */
export function proofsEventsStatements(
  proofs: BrowserProofStore,
  events: SecurityEventStore,
): Statements {
  return {
    'proof.issueBrowserProof': () =>
      proofs.issueBrowserProof({
        proofIdHash: HASH,
        tokenHash: HASH,
        expiresAt: TEST_NOW,
      }),
    'proof.findIssuedBrowserProof': () => proofs.findIssuedBrowserProof(HASH),
    'proof.claimBrowserProof': () => proofs.claimBrowserProof(HASH, TEST_NOW),
    'event.appendOutsideUnitOfWork': () =>
      events.appendOutsideUnitOfWork({
        eventId: 'event-1',
        action: 'contract.event',
        outcome: 'succeeded',
        occurredAt: TEST_NOW,
      }),
    'event.listRecentForUser': () => events.listRecentForUser('user-1', 10),
  };
}

/** What every one of those statements raises while the database is away. */
export const PROOFS_EVENTS_OUTAGES: Record<string, string> = {
  'proof.issueBrowserProof': UNAVAILABLE,
  'proof.findIssuedBrowserProof': UNAVAILABLE,
  'proof.claimBrowserProof': UNAVAILABLE,
  'event.appendOutsideUnitOfWork': UNAVAILABLE,
  'event.listRecentForUser': UNAVAILABLE,
};
