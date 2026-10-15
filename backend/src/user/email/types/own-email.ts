/** The session a request arrived on, as the guard validated it. */
export interface OwnEmailCaller {
  userId: string;
  sessionId: string;
  clientId: string;
  /** When the person last proved who they are on this session. */
  signedInAt: Date;
}

/** The account's address and the one it waits to confirm. */
export interface OwnEmailState {
  email: string;
  pendingEmail?: string;
}
