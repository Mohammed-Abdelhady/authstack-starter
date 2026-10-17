import { ErrorCode } from '@app/core';
import { ApiError } from '@app/sdk';
import { DELETION_REFUSAL } from '../constants/account-deletion';
import type { Locale, MessageKey } from '../i18n';

const REFUSAL_TEXT = new Map<string, MessageKey>([
  [DELETION_REFUSAL.ADMIN, 'deletion.admin'],
  [DELETION_REFUSAL.VALIDATION, 'deletion.invalid'],
  [DELETION_REFUSAL.CONFLICT, 'deletion.conflict'],
]);

export function deletionRefusal(error: unknown): MessageKey | undefined {
  if (error instanceof ApiError && error.code === ErrorCode.REAUTH_REQUIRED)
    return 'deletion.proofRequired';
  if (
    !(error instanceof ApiError) ||
    error.status < 400 ||
    error.status >= 500 ||
    error.status === 401
  )
    return undefined;
  return REFUSAL_TEXT.get(error.code) ?? 'deletion.refused';
}

/** The device's own time, with its zone named, as the erasure mail names its zone. */
export function erasureDate(locale: Locale, iso: string | undefined): string | undefined {
  if (iso === undefined || !Number.isFinite(Date.parse(iso))) return undefined;
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
}
