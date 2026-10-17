import type {
  NewProviderLinkTicket,
  ProviderLinkTicket,
} from '../types/provider-link';

/** Links a mobile app started, each spent once by its finish. */
export abstract class ProviderLinkTicketStore {
  abstract open(ticket: NewProviderLinkTicket): Promise<void>;

  /**
   * Marks the ticket spent and answers it, in one write. Null when no ticket
   * has the hash, or it is spent, lapsed, or another account's or session's:
   * a second finish of one ticket always gets null.
   */
  abstract spend(
    ticketHash: string,
    owner: { userId: string; sessionId: string },
    now: Date,
  ): Promise<ProviderLinkTicket | null>;
}
