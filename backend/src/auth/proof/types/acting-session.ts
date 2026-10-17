/** The signed-in session a staff request arrived on, as the server validated it. */
export interface ActingSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly clientId: string;
  /** When the session's sign-in happened. */
  readonly signedInAt: Date;
}
