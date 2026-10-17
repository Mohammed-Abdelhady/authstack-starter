export const FRESH_PROOF_PATH = '/api/auth/proof';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const PROOF_CODE_LENGTH = 6;
export const PROOF_CODE_PATTERN = /^[0-9]{6}$/;

export const PROOF_ACTION = {
  PASSKEY: 'passkey', // feature:passkeys
  SEND_CODE: 'send-code',
  VERIFY_CODE: 'verify-code',
} as const;
