/** The signed-in session a link belongs to, as the guard let it in. */
export interface ProviderLinkCaller {
  userId: string;
  sessionId: string;
  clientId: string;
  /** When the session's sign-in happened. */
  signedInAt: Date;
}

export interface NewProviderLinkTicket {
  ticketHash: string;
  userId: string;
  sessionId: string;
  clientId: string;
  provider: string;
  nonceDigest: string;
  expiresAt: Date;
}

export type ProviderLinkTicket = NewProviderLinkTicket;

/** What the start answers. The app passes the digest and state to its prompt. */
export interface ProviderLinkStart {
  linkId: string;
  nonceDigest: string;
  state: string;
  expiresAt: string;
}
