import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import {
  ErrorCode,
  getErrorCodeTranslationKey,
  getStatusCodeTranslationKey,
  parseApiError,
} from '@app/core';
import { HTTP_STATUS } from '@/constants/httpStatus';
import { ERROR_MESSAGES, STATUS_CODE_MESSAGES } from '@/constants/toastMessages';
import { toMessageValues, type MessageValues } from '@/i18n/icu-args';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';

/** A catalogue message for a request that failed. The server's own text is never shown. */
export interface RefusalMessage {
  messageKey: string;
  /** Used when `messageKey` has no entry, or needs an argument `values` lacks. */
  fallbackKey?: string;
  values?: MessageValues;
}

/** What a request failed with, as the query layer hands it over. */
export type RequestError = FetchBaseQueryError;

/** The form field each refusal names. A code not listed here names no field. */
export const REFUSAL_FIELDS: Readonly<Record<string, string>> = {
  [ErrorCode.EMAIL_ALREADY_EXISTS]: 'email',
  [ErrorCode.ROLE_NAME_TAKEN]: 'name',
  [ErrorCode.INVALID_CURRENT_PASSWORD]: 'currentPassword',
  [ErrorCode.SAME_PASSWORD]: 'newPassword',
};

function isRequestError(error: unknown): error is RequestError {
  return typeof error === 'object' && error !== null && 'status' in error;
}

/**
 * The HTTP status of a rejection. A proxy answers with HTML the query layer
 * cannot parse, and that rejection still carries the status it came with.
 */
export function httpStatusOf(error: RequestError): number | undefined {
  if (typeof error.status === 'number') return error.status;
  return error.status === 'PARSING_ERROR' ? error.originalStatus : undefined;
}

function statusMessageKey(status: number | undefined): string {
  return (
    (status === undefined ? undefined : STATUS_CODE_MESSAGES[status]) ??
    getStatusCodeTranslationKey(status)
  );
}

function isTimeout(error: RequestError, status: number | undefined): boolean {
  return (
    error.status === 'TIMEOUT_ERROR' ||
    status === HTTP_STATUS.REQUEST_TIMEOUT ||
    status === HTTP_STATUS.GATEWAY_TIMEOUT
  );
}

/**
 * The one message for a failed request, whoever shows it: the toast, a form's
 * alert or a field. A code the catalogue knows gives its own message, anything
 * else the message of its status, and something that is no request error the
 * generic one.
 */
export function refusalMessage(error: unknown): RefusalMessage {
  if (!isRequestError(error)) return { messageKey: ERROR_MESSAGES.UNKNOWN_ERROR };
  const status = httpStatusOf(error);
  if (isTimeout(error, status)) return { messageKey: ERROR_MESSAGES.TIMEOUT_ERROR };
  if (error.status === 'FETCH_ERROR') return { messageKey: ERROR_MESSAGES.NETWORK_ERROR };

  const fallbackKey = statusMessageKey(status);
  const code = translatableErrorCode(error, '');
  // The server's own text is English only, so an unknown code shows the status message.
  if (!code) return { messageKey: fallbackKey };
  return {
    messageKey: getErrorCodeTranslationKey(code),
    fallbackKey,
    values: toMessageValues(parseApiError(error).details),
  };
}

/** The form field a refusal names, when its code names one. */
export function refusedField(error: unknown): string | undefined {
  const code = translatableErrorCode(error, '');
  return code ? REFUSAL_FIELDS[code] : undefined;
}

const ownedRequests = new Set<string>();

/**
 * Marks a request whose refusal the caller shows itself, in its form or its
 * dialog, so the store does not raise a toast that says it a second time.
 *
 * @example
 * ```ts
 * await showsOwnRefusal(createUser(body)).unwrap();
 * ```
 */
export function showsOwnRefusal<
  Request extends { requestId: string; unwrap: () => Promise<unknown> },
>(request: Request): Request {
  ownedRequests.add(request.requestId);
  // Accepted requests are never asked about, so the mark is taken back here.
  const forget = () => ownedRequests.delete(request.requestId);
  request.unwrap().then(forget, forget);
  return request;
}

/** Whether the caller of this request shows its refusal itself. */
export function isOwnRefusal(requestId: string | undefined): boolean {
  return requestId !== undefined && ownedRequests.has(requestId);
}
