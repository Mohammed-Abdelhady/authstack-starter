import { INVITATION_ERROR_KEYS } from '../constants/invitations';
import { errorBody, isRecord } from '@/modules/auth/utils/staffErrors';
export { freshProofMethods } from '@/modules/auth/utils/staffErrors';

export function invitationErrorKey(error: unknown) {
  const code = errorBody(error).code;
  if (typeof code === 'string' && Object.hasOwn(INVITATION_ERROR_KEYS, code)) {
    return INVITATION_ERROR_KEYS[code as keyof typeof INVITATION_ERROR_KEYS];
  }
  return 'generic';
}

export function invitationErrorFields(error: unknown): string[] {
  const body = errorBody(error);
  if (body.code === 'EMAIL_ALREADY_EXISTS') return ['email'];
  if (body.code !== 'VALIDATION_ERROR' || !isRecord(body.details)) return [];
  return isRecord(body.details.fields) ? Object.keys(body.details.fields) : [];
}
