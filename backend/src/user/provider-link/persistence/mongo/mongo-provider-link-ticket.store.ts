import { Collection, Db, ObjectId } from 'mongodb';
import { MalformedIdError } from '../../../../common/persistence/persistence-errors';
import { ProviderLinkTicketStore } from '../../stores/provider-link-ticket.store';
import type {
  NewProviderLinkTicket,
  ProviderLinkTicket,
} from '../../types/provider-link';

type ProviderLinkTicketDocument = NewProviderLinkTicket & {
  _id: ObjectId;
  spentAt: Date | null;
};

export const PROVIDER_LINK_TICKET_COLLECTION = 'provider_link_tickets';

function accountId(value: string): string {
  if (!ObjectId.isValid(value)) throw new MalformedIdError();
  return new ObjectId(value).toHexString();
}

export class MongoProviderLinkTicketStore extends ProviderLinkTicketStore {
  private readonly tickets: Collection<ProviderLinkTicketDocument>;

  constructor(db: Db) {
    super();
    this.tickets = db.collection<ProviderLinkTicketDocument>(
      PROVIDER_LINK_TICKET_COLLECTION,
    );
  }

  async ensureIndexes(): Promise<void> {
    await this.tickets.createIndex(
      { ticketHash: 1 },
      { unique: true, name: 'provider_link_ticket_hash_unique' },
    );
    await this.tickets.createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'provider_link_ticket_expires_at' },
    );
  }

  async open(ticket: NewProviderLinkTicket): Promise<void> {
    await this.tickets.insertOne({
      ...ticket,
      _id: new ObjectId(),
      userId: accountId(ticket.userId),
      spentAt: null,
    });
  }

  async spend(
    ticketHash: string,
    owner: { userId: string; sessionId: string },
    now: Date,
  ): Promise<ProviderLinkTicket | null> {
    let userId: string;
    try {
      userId = accountId(owner.userId);
    } catch (error) {
      if (error instanceof MalformedIdError) return null;
      throw error;
    }
    const row = await this.tickets.findOneAndUpdate(
      {
        ticketHash,
        userId,
        sessionId: owner.sessionId,
        spentAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { spentAt: now } },
      { returnDocument: 'after' },
    );
    return row
      ? {
          ticketHash: row.ticketHash,
          userId: row.userId,
          sessionId: row.sessionId,
          clientId: row.clientId,
          provider: row.provider,
          nonceDigest: row.nonceDigest,
          expiresAt: row.expiresAt,
        }
      : null;
  }
}
