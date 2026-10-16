import { INVITATION_ERROR_KEYS } from '../constants/invitations';
import type { ProofMethod } from '../types/invitation.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorBody(error: unknown): Record<string, unknown> {
  if (!isRecord(error) || !isRecord(error.data) || !isRecord(error.data.error)) return {};
  return error.data.error;
}

export function invitationErrorKey(error: unknown) {
  const code = errorBody(error).code;
  if (typeof code === 'string' && Object.hasOwn(INVITATION_ERROR_KEYS, code)) {
    return INVITATION_ERROR_KEYS[code as keyof typeof INVITATION_ERROR_KEYS];
  }
  return 'generic';
}

export function freshProofMethods(error: unknown): ProofMethod[] | null {
  const body = errorBody(error);
  if (body.code !== 'REAUTH_REQUIRED' || !isRecord(body.details)) return null;
  if (body.details.required !== 'fresh_proof' || !Array.isArray(body.details.methods)) return null;
  const methods = body.details.methods.filter(
    (method: unknown): method is ProofMethod => method === 'passkey' || method === 'email-code',
  );
  return methods.length ? [...new Set(methods)] : null;
}

export function invitationErrorFields(error: unknown): string[] {
  const body = errorBody(error);
  if (body.code === 'EMAIL_ALREADY_EXISTS') return ['email'];
  if (body.code !== 'VALIDATION_ERROR' || !isRecord(body.details)) return [];
  return isRecord(body.details.fields) ? Object.keys(body.details.fields) : [];
}
