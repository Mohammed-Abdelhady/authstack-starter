import { ErrorCode } from '@app/core';
import type { ProofMethod } from '../types/staff-operation.types';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorBody(error: unknown): Record<string, unknown> {
  if (!isRecord(error) || !isRecord(error.data) || !isRecord(error.data.error)) return {};
  return error.data.error;
}

export function freshProofMethods(error: unknown): ProofMethod[] | null {
  const body = errorBody(error);
  if (body.code !== ErrorCode.REAUTH_REQUIRED || !isRecord(body.details)) return null;
  if (body.details.required !== 'fresh_proof' || !Array.isArray(body.details.methods)) return null;
  const methods = body.details.methods.filter(
    (method: unknown): method is ProofMethod => method === 'passkey' || method === 'email-code',
  );
  return methods.length ? [...new Set(methods)] : null;
}

const PROOF_ERROR_KEYS = {
  [ErrorCode.REAUTH_REQUIRED]: 'errors.reauth',
  [ErrorCode.ACTIVATION_CODE_INVALID]: 'errors.invalidCode',
  [ErrorCode.PASSKEY_VERIFICATION_FAILED]: 'errors.passkeyFailed',
} as const;

export function proofErrorKey(error: unknown): string {
  const code = errorBody(error).code;
  return typeof code === 'string' && Object.hasOwn(PROOF_ERROR_KEYS, code)
    ? PROOF_ERROR_KEYS[code as keyof typeof PROOF_ERROR_KEYS]
    : 'errors.generic';
}

export function isProofRefusal(error: unknown): boolean {
  const code = errorBody(error).code;
  return typeof code === 'string' && Object.hasOwn(PROOF_ERROR_KEYS, code);
}
