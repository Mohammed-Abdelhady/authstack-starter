import type { Kysely } from 'kysely';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import type { PostgresTables } from '../../../../common/persistence/postgres/postgres-database';
import { toUuid } from '../../../../session/persistence/postgres/postgres-issuance-mappers';
import { ProviderLinkTicketStore } from '../../stores/provider-link-ticket.store';
import type {
  NewProviderLinkTicket,
  ProviderLinkTicket,
} from '../../types/provider-link';

export class PostgresProviderLinkTicketStore extends ProviderLinkTicketStore {
  constructor(private readonly database: Kysely<PostgresTables>) {
    super();
  }

  async open(ticket: NewProviderLinkTicket): Promise<void> {
    await this.database
      .insertInto('provider_link_tickets')
      .values({
        ticket_hash: ticket.ticketHash,
        user_id: toUuid(ticket.userId),
        session_id: ticket.sessionId,
        client_id: ticket.clientId,
        provider: ticket.provider,
        nonce_digest: ticket.nonceDigest,
        expires_at: ticket.expiresAt,
      })
      .execute();
  }

  async spend(
    ticketHash: string,
    owner: { userId: string; sessionId: string },
    now: Date,
  ): Promise<ProviderLinkTicket | null> {
    let userId: string;
    try {
      userId = toUuid(owner.userId);
    } catch (error) {
      if (error instanceof MalformedIdError) return null;
      throw error;
    }
    const row = await this.database
      .updateTable('provider_link_tickets')
      .set({ spent_at: now })
      .where('ticket_hash', '=', ticketHash)
      .where('user_id', '=', userId)
      .where('session_id', '=', owner.sessionId)
      .where('spent_at', 'is', null)
      .where('expires_at', '>', now)
      .returningAll()
      .executeTakeFirst();
    return row
      ? {
          ticketHash: row.ticket_hash,
          userId: row.user_id,
          sessionId: row.session_id,
          clientId: row.client_id,
          provider: row.provider,
          nonceDigest: row.nonce_digest,
          expiresAt: row.expires_at,
        }
      : null;
  }
}
