import { FrozenClock, TEST_NOW } from '../../../test/utils/frozen-clock';
import { ProviderLinkTicketStore } from './stores/provider-link-ticket.store';
import type { NewProviderLinkTicket } from './types/provider-link';

interface ProviderLinkHarness {
  store: ProviderLinkTicketStore;
  clock: FrozenClock;
  userId: string;
  otherUserId: string;
  reset: () => Promise<void>;
  close: () => Promise<void>;
  checkSetup: () => Promise<void>;
}

const LIFETIME_MS = 60_000;
const SESSION_ID = 'link-session';
const OTHER_SESSION_ID = 'other-session';
const TICKET_HASH = 'link-ticket-hash';

export function describeProviderLinkContract(
  name: string,
  boot: () => Promise<ProviderLinkHarness>,
  timeouts: { bootMs: number; resetMs: number; teardownMs: number },
): void {
  describe(`${name} provider link ticket store`, () => {
    let harness: ProviderLinkHarness;

    beforeAll(async () => {
      harness = await boot();
    }, timeouts.bootMs);
    beforeEach(async () => {
      harness.clock.set(TEST_NOW);
      await harness.reset();
    }, timeouts.resetMs);
    afterAll(async () => {
      await harness?.close();
    }, timeouts.teardownMs);

    function ticket(): NewProviderLinkTicket {
      return {
        ticketHash: TICKET_HASH,
        userId: harness.userId,
        sessionId: SESSION_ID,
        clientId: 'mobile-client',
        provider: 'google',
        nonceDigest: 'nonce-digest',
        expiresAt: new Date(TEST_NOW.getTime() + LIFETIME_MS),
      };
    }

    function spend(userId = harness.userId, sessionId = SESSION_ID) {
      return harness.store.spend(
        TICKET_HASH,
        { userId, sessionId },
        harness.clock.now(),
      );
    }

    it('has ticket uniqueness and expiry indexes', async () => {
      await harness.checkSetup();
    });

    it('returns a ticket once and refuses replay', async () => {
      await harness.store.open(ticket());
      expect(await spend()).toEqual({
        ticketHash: 'link-ticket-hash',
        userId: harness.userId,
        sessionId: 'link-session',
        clientId: 'mobile-client',
        provider: 'google',
        nonceDigest: 'nonce-digest',
        expiresAt: new Date('2099-01-01T12:01:00.000Z'),
      });
      expect(await spend()).toBeNull();
    });

    it('refuses another account or session without spending the ticket', async () => {
      await harness.store.open(ticket());
      expect(await spend(harness.otherUserId)).toBeNull();
      expect(await spend(harness.userId, OTHER_SESSION_ID)).toBeNull();
      expect(await spend('malformed-account')).toBeNull();
      expect(await spend()).toMatchObject({
        ticketHash: 'link-ticket-hash',
        userId: harness.userId,
        sessionId: 'link-session',
      });
    });

    it('refuses a ticket at expiry and after expiry', async () => {
      await harness.store.open(ticket());
      harness.clock.advance(LIFETIME_MS);
      expect(await spend()).toBeNull();
      harness.clock.advance(1);
      expect(await spend()).toBeNull();
    });
  });
}
