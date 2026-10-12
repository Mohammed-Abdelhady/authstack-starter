import type { MailCounterPurpose } from '../../src/auth/constants/registration';
import type { MailCounterSeed } from './mail-counter-seed';
import type { RaceGate } from './race-gate';

export interface E2eLinkedAccount {
  provider: string;
  providerId: string;
  linkedAt: Date;
}

/** A mailed code waiting for its address to be proved. */
export interface E2eNewPendingRegistration {
  email: string;
  purpose: string;
  hashedCode: string;
  attempts: number;
  expiresAt: Date;
  /** The account an address change is bound to. */
  userId?: string;
  addressGeneration?: number;
}

/** The fields a case changes on the pending record it stores. */
export type E2ePendingRegistrationFields = Partial<
  Omit<E2eNewPendingRegistration, 'email'>
>;

export type E2ePendingRegistrationCode = Pick<
  E2eNewPendingRegistration,
  'purpose' | 'hashedCode' | 'attempts' | 'expiresAt'
>;

export interface E2ePendingRegistration {
  purpose: string;
  hashedCode: string;
  attempts: number;
  addressGeneration?: number;
}

export interface E2eNewPendingPasswordReset {
  email: string;
  hashedCode: string;
  attempts: number;
  expiresAt: Date;
}

export type E2ePendingPasswordResetCode = Omit<
  E2eNewPendingPasswordReset,
  'email'
>;

export interface E2ePendingPasswordReset {
  hashedCode: string;
  attempts: number;
}

// feature:magic-link:start
export interface E2eMagicLink {
  email: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
// feature:magic-link:end

// feature:passkeys:start
export interface E2eNewPasskey {
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  name: string;
  lastUsedAt: Date | null;
}
// feature:passkeys:end

/** What a commit whose outcome the server cannot learn did before it went silent. */
export interface E2eUnknownCommit {
  /** True when the work was stored before the answer was lost. */
  lands: boolean;
  /** The failure carries nothing that marks it as a commit failure. */
  bareNetworkError?: boolean;
}

/** Puts back what a fault or a hold replaced. */
export type E2eRestore = () => void;

/** A mock whose calls a case counts with `toHaveBeenCalledTimes`. */
export interface E2eWatchedCalls {
  readonly mock: { readonly calls: readonly unknown[] };
}

/** What only the sign-up, sign-in and account cases need of an account. */
export interface E2eAccountState {
  countAccountsWithAddress(email: string): Promise<number>;
  /** Leaves the account with no password to sign in with. */
  removePassword(email: string): Promise<void>;
  /** Makes these the provider accounts linked to the account. */
  linkProviderAccounts(email: string, links: E2eLinkedAccount[]): Promise<void>;
  /** Makes the account one this provider created, with these links. */
  makeProviderCreated(
    email: string,
    provider: string,
    links: E2eLinkedAccount[],
  ): Promise<void>;
  // feature:passkeys:start
  /** Stores a passkey for the account, the way a registration leaves one. */
  storePasskey(email: string, passkey: E2eNewPasskey): Promise<string>;
  countPasskeys(): Promise<number>;
  removeEveryPasskey(): Promise<void>;
  // feature:passkeys:end
}

/** Mailed codes, their counters and mailed links. */
export interface E2ePendingCodeState {
  storePendingRegistration(record: E2eNewPendingRegistration): Promise<void>;
  pendingRegistrationFor(email: string): Promise<E2ePendingRegistration | null>;
  /** Every stored field of the record, under the names the record gives them. */
  storedPendingRegistrationFields(
    email: string,
  ): Promise<Record<string, unknown> | null>;
  countPendingRegistrations(email: string, purpose?: string): Promise<number>;
  /** Removes one record of the address, as a consume during the request would. */
  removePendingRegistration(email: string): Promise<void>;
  removeEveryPendingRegistration(email: string): Promise<void>;
  /** Gives the stored record this code, as a newer request would. */
  replacePendingRegistrationCode(
    email: string,
    code: E2ePendingRegistrationCode,
  ): Promise<void>;

  storePendingPasswordReset(record: E2eNewPendingPasswordReset): Promise<void>;
  pendingPasswordResetFor(
    email: string,
  ): Promise<E2ePendingPasswordReset | null>;
  countPendingPasswordResets(email: string): Promise<number>;
  removePendingPasswordReset(email: string): Promise<void>;
  replacePendingPasswordResetCode(
    email: string,
    code: E2ePendingPasswordResetCode,
  ): Promise<void>;

  storeMailCounter(seed: MailCounterSeed): Promise<void>;
  mailCounterFor(
    email: string,
    purpose: MailCounterPurpose,
  ): Promise<{ mailedCodes: number } | null>;
  // feature:magic-link:start
  storeMagicLinks(links: E2eMagicLink[]): Promise<void>;
  /** Gives every stored link an expiry that has passed. */
  expireMagicLinks(): Promise<void>;
  // feature:magic-link:end
}

/** Where a case holds a request or makes the database fail under it. */
export interface E2eAuthFaults {
  /** Holds the first new pending registration on one gate and the rest on the other. */
  holdPendingRegistrationInserts(first: RaceGate, later: RaceGate): E2eRestore;
  /** Holds the first `count` consumes of a pending registration on the gate. */
  holdPendingRegistrationConsumes(gate: RaceGate, count: number): E2eRestore;
  /** Holds the first new pending password reset on one gate and the rest on the other. */
  holdPendingPasswordResetInserts(first: RaceGate, later: RaceGate): E2eRestore;
  /** The next write of an activated account is refused. */
  failNextAccountWrite(): E2eRestore;
  /** The next read of a role's permissions is answered with a failure. */
  failNextRoleRead(): E2eRestore;
  /**
   * Every commit goes silent until restored: the server gets no answer and
   * cannot learn what became of the work.
   */
  makeCommitOutcomesUnknown(commit: E2eUnknownCommit): E2eRestore;
  /**
   * Every commit is abandoned without storing anything, waits on the gate, and
   * only then goes silent.
   */
  abandonCommitsThenGoSilent(gate: RaceGate): E2eRestore;
  /** The reads that look an account up again after a silent commit. */
  watchAccountLookupsAfterCommit(): E2eWatchedCalls;
  /** The next such read fails with a `TypeError`. */
  failNextAccountLookupAfterCommit(): E2eRestore;
  /**
   * The next write that ends an account's sessions waits on the gate, then is
   * refused as a conflict the database asks to be run again.
   */
  abortNextSessionEndingWrite(gate: RaceGate): E2eRestore;
}

/** The state the sign-up, sign-in and account cases arrange and read. */
export interface E2eAuthState
  extends E2eAccountState, E2ePendingCodeState, E2eAuthFaults {}
