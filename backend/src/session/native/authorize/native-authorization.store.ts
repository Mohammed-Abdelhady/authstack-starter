import { UnitOfWork } from '../../../common/persistence/unit-of-work';

export const AUTHORIZATION_APPROVAL = {
  APPROVED: 'approved',
  NOT_PENDING: 'not_pending',
} as const;

export type AuthorizationApprovalOutcome =
  (typeof AUTHORIZATION_APPROVAL)[keyof typeof AUTHORIZATION_APPROVAL];

export const GRANT_VERSION_CAPTURE = {
  CAPTURED: 'captured',
  NOT_APPROVED: 'not_approved',
} as const;

export type GrantVersionCapture =
  (typeof GRANT_VERSION_CAPTURE)[keyof typeof GRANT_VERSION_CAPTURE];

export const AUTHORIZATION_DENIAL = {
  DENIED: 'denied',
  NOT_PENDING: 'not_pending',
} as const;

export type AuthorizationDenial =
  | {
      outcome: typeof AUTHORIZATION_DENIAL.DENIED;
      redirectUri: string;
      state: string;
    }
  | { outcome: typeof AUTHORIZATION_DENIAL.NOT_PENDING };

export const CODE_SPEND = {
  SPENT: 'spent',
  ALREADY_SPENT: 'already_spent',
} as const;

export type CodeSpend = (typeof CODE_SPEND)[keyof typeof CODE_SPEND];

export interface NewPendingAuthorization {
  transactionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  requestedScopes: string[];
  audience: string;
  expiresAt: Date;
  authEpoch: number;
}

export interface PendingAuthorization {
  id: string;
  transactionId: string;
  clientId: string;
  redirectUri: string;
  state: string;
  expiresAt: Date;
}

/** An approved request whose code has not been spent, with all it captured. */
export interface AuthorizationCode {
  id: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string | null;
  codeExpiresAt: Date | null;
  requestedScopes: string[];
  audience: string | null;
  authenticationMethods: string[];
  capturedUserVersion: number | null;
  capturedClientVersion: number | null;
  capturedGrantVersion: number | null;
  authEpoch: number;
}

/** Whose code a refused proof was presented with. */
export interface CodeHolder {
  clientId: string;
  userId: string | null;
}

export interface AuthorizationApproval {
  now: Date;
  codeHash: string;
  codeExpiresAt: Date;
  userId: string;
  capturedUserVersion: number;
  capturedClientVersion: number;
  authenticationMethods: string[];
}

export interface AuthorizationDenialGuard {
  transactionId: string;
  redirectUri: string;
  now: Date;
}

/**
 * Mobile sign-in requests waiting for a person's decision.
 *
 * A request is pending while it is not denied, holds no code and `now` is
 * before its expiry. Every method that takes `now` compares the stored expiry
 * with it and never relies on expired rows having been removed.
 *
 * Approve and deny have one winner: each is a guarded write that changes a
 * request only while it is still pending, and says which it was. A code is
 * spent once the same way. Reads of a code hand back its expiry and the caller
 * compares it. Ids are opaque strings, and one this database could not have
 * issued is `MalformedIdError`.
 *
 * One exchange per code at a time: once `spendCodeIn` has returned, no other
 * unit of work can spend that code until this one ends. An adapter may take the
 * code earlier, at `findUnspentCodeIn`. A second unit of work that reaches a
 * taken code is refused at once with a retryable abort. It does not wait.
 */
export abstract class NativeAuthorizationStore {
  /** Commits by itself. */
  abstract createPending(pending: NewPendingAuthorization): Promise<void>;

  /** A plain read of a request that is pending at `now`. */
  abstract findPending(
    transactionId: string,
    now: Date,
  ): Promise<PendingAuthorization | null>;

  abstract findPendingIn(
    unitOfWork: UnitOfWork,
    transactionId: string,
    now: Date,
  ): Promise<PendingAuthorization | null>;

  /** Gives a pending request its code, account and captured versions. */
  abstract approve(
    unitOfWork: UnitOfWork,
    id: string,
    approval: AuthorizationApproval,
  ): Promise<AuthorizationApprovalOutcome>;

  /** Records the grant's version on the request this unit of work approved. */
  abstract captureGrantVersion(
    unitOfWork: UnitOfWork,
    id: string,
    codeHash: string,
    grantVersion: number,
  ): Promise<GrantVersionCapture>;

  /** Ends a pending request without a code. Commits by itself. */
  abstract deny(
    id: string,
    guard: AuthorizationDenialGuard,
  ): Promise<AuthorizationDenial>;

  /** A plain read of the request that holds this code, while it is unspent. */
  abstract findUnspentCode(codeHash: string): Promise<AuthorizationCode | null>;

  /** A plain read of who holds a code that is unspent and unexpired at `now`. */
  abstract findCodeHolder(
    codeHash: string,
    now: Date,
  ): Promise<CodeHolder | null>;

  /** Spends a code presented with the wrong verifier. Commits by itself. */
  abstract spendCode(id: string): Promise<CodeSpend>;

  abstract findUnspentCodeIn(
    unitOfWork: UnitOfWork,
    id: string,
  ): Promise<AuthorizationCode | null>;

  /** Spends a code that is still unspent, with the exchange's unit of work. */
  abstract spendCodeIn(unitOfWork: UnitOfWork, id: string): Promise<CodeSpend>;
}
