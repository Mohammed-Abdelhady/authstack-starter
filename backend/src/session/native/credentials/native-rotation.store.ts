import { UnitOfWork } from '../../../common/persistence/unit-of-work';

export const REFRESH_CLAIM = {
  CLAIMED: 'claimed',
  ALREADY_SPENT: 'already_spent',
} as const;

export type RefreshClaim = (typeof REFRESH_CLAIM)[keyof typeof REFRESH_CLAIM];

export const SUCCESSOR_LINK = {
  LINKED: 'linked',
  NOT_SPENT: 'not_spent',
} as const;

export type SuccessorLink =
  (typeof SUCCESSOR_LINK)[keyof typeof SUCCESSOR_LINK];

export const SESSION_KEY_BINDING = {
  BOUND: 'bound',
  ALREADY_BOUND: 'already_bound',
} as const;

export type SessionKeyBinding =
  (typeof SESSION_KEY_BINDING)[keyof typeof SESSION_KEY_BINDING];

export const RETRY_CLAIM = {
  CLAIMED: 'claimed',
  IN_PROGRESS: 'in_progress',
} as const;

export type RetryClaim = (typeof RETRY_CLAIM)[keyof typeof RETRY_CLAIM];

export const SUCCESSOR_REVOCATION = {
  REVOKED: 'revoked',
  ALREADY_USED: 'already_used',
} as const;

export type SuccessorRevocation =
  (typeof SUCCESSOR_REVOCATION)[keyof typeof SUCCESSOR_REVOCATION];

export const REPLACEMENT_LINK = {
  LINKED: 'linked',
  CLAIM_LAPSED: 'claim_lapsed',
} as const;

export type ReplacementLink =
  (typeof REPLACEMENT_LINK)[keyof typeof REPLACEMENT_LINK];

export interface SuccessorHashes {
  accessHash: string;
  refreshHash: string;
}

/** The spent token whose successor pair is looked up. */
export interface SuccessorLookup extends SuccessorHashes {
  familyId: string;
  sessionId: string;
  clientId: string;
  generation: number;
}

export interface UnusedSuccessor {
  accessId: string;
  refreshId: string;
  generation: number;
}

/**
 * The guarded writes of refresh rotation and of the same-key retry. Each
 * changes a token only while the stored token is still in the state its name
 * says, and answers which it was. All of them belong to the family's one unit
 * of work, under the rule `NativeCredentialStore` states.
 */
export abstract class NativeRotationStore {
  /** Spends a refresh token that is still unspent. */
  abstract claimRefresh(
    unitOfWork: UnitOfWork,
    credentialId: string,
    now: Date,
  ): Promise<RefreshClaim>;

  /** Ends the family's access tokens that are still unspent. */
  abstract retireAccessTokens(
    unitOfWork: UnitOfWork,
    family: { familyId: string; sessionId: string; now: Date },
  ): Promise<void>;

  /** Names the new pair on the spent token it replaced. */
  abstract linkSuccessors(
    unitOfWork: UnitOfWork,
    credentialId: string,
    successors: SuccessorHashes,
  ): Promise<SuccessorLink>;

  /** Gives a session its device key, unless it has one. */
  abstract bindSessionKey(
    unitOfWork: UnitOfWork,
    sessionId: string,
    thumbprint: string,
  ): Promise<SessionKeyBinding>;

  /**
   * The pair that replaced a spent token, when neither half has been spent,
   * ended or used, and no access token of its generation was ever used.
   */
  abstract findUnusedSuccessor(
    unitOfWork: UnitOfWork,
    spent: SuccessorLookup,
  ): Promise<UnusedSuccessor | null>;

  /**
   * Takes the retry of a spent, unended token until `until`, unless another
   * retry holds it past `now`.
   */
  abstract claimRetry(
    unitOfWork: UnitOfWork,
    credentialId: string,
    window: { now: Date; until: Date },
  ): Promise<RetryClaim>;

  /** Ends both halves of a successor pair that is still unused. */
  abstract revokeUnusedSuccessor(
    unitOfWork: UnitOfWork,
    successor: { accessId: string; refreshId: string; now: Date },
  ): Promise<SuccessorRevocation>;

  /** Names the replacement pair while this retry's claim still holds at `now`. */
  abstract linkReplacement(
    unitOfWork: UnitOfWork,
    credentialId: string,
    replacement: SuccessorHashes & { now: Date },
  ): Promise<ReplacementLink>;
}
