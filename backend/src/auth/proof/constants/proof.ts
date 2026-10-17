/** A mailed proof code lives ten minutes. Its proof counts only inside the action window. */
export const PROOF_CODE_LIFETIME_MS = 600_000;

/** A passkey proof challenge lives five minutes, as a sign-in challenge does. */
export const PROOF_CHALLENGE_LIFETIME_MS = 300_000;

/** Wrong answers that end a proof challenge. */
export const PROOF_MAX_WRONG_GUESSES = 5;

/** `details.required` on a REAUTH_REQUIRED refusal that asks for a fresh proof. */
export const FRESH_PROOF_REQUIRED = 'fresh_proof';
