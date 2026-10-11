/**
 * Error Interceptor Middleware
 *
 * Owns what a person is told when a request is rejected: one localized toast,
 * or a session check for a 401. Forms do not raise a toast of their own.
 *
 * EXECUTION ORDER: Must run AFTER RTK Query middleware to access error metadata
 */

import { createElement } from 'react';
import {
  isRejected,
  type Middleware,
  type ThunkDispatch,
  type UnknownAction,
} from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { getErrorCodeTranslationKey, getStatusCodeTranslationKey, parseApiError } from '@app/core';
import {
  LocalizedToastMessage,
  type LocalizedToastMessageProps,
} from '@/components/ui/LocalizedToastMessage';
import {
  HTTP_STATUS,
  SUCCESS_STATUS_MAX_EXCLUSIVE,
  SUCCESS_STATUS_MIN,
} from '@/constants/httpStatus';
import { ERROR_MESSAGES, STATUS_CODE_MESSAGES, TOAST_DURATION } from '@/constants/toastMessages';
import { toMessageValues } from '@/i18n/icu-args';
import { toast } from '@/lib/toast';
import { authApi } from '@/modules/auth/store/authApi';
import { translatableErrorCode } from '@/modules/auth/utils/errorCodeMessage';

/** The query that answers whether the session is still valid. */
const SESSION_CHECK_ENDPOINT = 'getCurrentUser';

interface Announcement extends LocalizedToastMessageProps {
  duration: number;
  /** Announcements that share an id show as one toast, however many requests failed. */
  id?: string;
}

interface RejectionMeta {
  aborted: boolean;
  condition: boolean;
  rejectedWithValue: boolean;
  endpointName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readMeta(meta: unknown): RejectionMeta {
  const record = isRecord(meta) ? meta : {};
  const arg = isRecord(record.arg) ? record.arg : {};
  return {
    aborted: record.aborted === true,
    condition: record.condition === true,
    rejectedWithValue: record.rejectedWithValue === true,
    endpointName: typeof arg.endpointName === 'string' ? arg.endpointName : undefined,
  };
}

function isSignedIn(state: unknown): boolean {
  return isRecord(state) && isRecord(state.auth) && state.auth.isAuthenticated === true;
}

/**
 * The HTTP status of a rejection. A proxy answers with HTML the query layer
 * cannot parse, and that rejection still carries the status it came with.
 */
function httpStatus(error: FetchBaseQueryError): number | undefined {
  if (typeof error.status === 'number') return error.status;
  return error.status === 'PARSING_ERROR' ? error.originalStatus : undefined;
}

function isSuccessStatus(status: number | undefined): boolean {
  return (
    status === undefined || (status >= SUCCESS_STATUS_MIN && status < SUCCESS_STATUS_MAX_EXCLUSIVE)
  );
}

function statusMessageKey(status: number | undefined): string {
  return (
    (status === undefined ? undefined : STATUS_CODE_MESSAGES[status]) ??
    getStatusCodeTranslationKey(status)
  );
}

function durationFor(status: number | undefined): number {
  const isCritical =
    status === HTTP_STATUS.INTERNAL_SERVER_ERROR || status === HTTP_STATUS.SERVICE_UNAVAILABLE;
  return isCritical ? TOAST_DURATION.CRITICAL_ERROR : TOAST_DURATION.ERROR;
}

/** What to tell the person about a rejection the server or the network returned. */
function announcementFor(error: FetchBaseQueryError): Announcement | null {
  const status = httpStatus(error);

  if (error.status === 'PARSING_ERROR' && isSuccessStatus(status)) {
    return null;
  }
  if (
    error.status === 'TIMEOUT_ERROR' ||
    status === HTTP_STATUS.REQUEST_TIMEOUT ||
    status === HTTP_STATUS.GATEWAY_TIMEOUT
  ) {
    return { messageKey: ERROR_MESSAGES.TIMEOUT_ERROR, duration: TOAST_DURATION.TIMEOUT_ERROR };
  }
  if (error.status === 'FETCH_ERROR') {
    // A lost connection fails every request on the page, and it is one thing to say.
    return {
      id: ERROR_MESSAGES.NETWORK_ERROR,
      messageKey: ERROR_MESSAGES.NETWORK_ERROR,
      duration: TOAST_DURATION.NETWORK_ERROR,
    };
  }

  const fallbackKey = statusMessageKey(status);
  const code = translatableErrorCode(error, '');
  if (!code) {
    // The server's own text is English only, so an unknown code shows the status message.
    return { messageKey: fallbackKey, duration: durationFor(status) };
  }
  return {
    messageKey: getErrorCodeTranslationKey(code),
    fallbackKey,
    values: toMessageValues(parseApiError(error).details),
    duration: durationFor(status),
  };
}

function announce({ duration, id, ...message }: Announcement): void {
  toast.show('error', createElement(LocalizedToastMessage, message), { duration, id });
}

type InterceptorDispatch = ThunkDispatch<unknown, unknown, UnknownAction>;

/**
 * Error interceptor middleware
 *
 * Sees every rejected request once. A 401 while signed in starts the session
 * check, so the guards sign the person out. Everything else that is not an
 * abort raises one toast.
 */
export const errorInterceptor: Middleware<object, unknown, InterceptorDispatch> =
  ({ dispatch, getState }) =>
  (next) =>
  (action) => {
    if (!isRejected(action)) {
      return next(action);
    }
    const meta = readMeta(action.meta);
    // A request that was skipped or cancelled did not fail.
    if (meta.condition || meta.aborted) {
      return next(action);
    }

    if (!meta.rejectedWithValue) {
      // Thrown instead of returned, for example a reply the client could not read.
      announce({ messageKey: ERROR_MESSAGES.UNKNOWN_ERROR, duration: TOAST_DURATION.ERROR });
      return next(action);
    }

    const error = action.payload as FetchBaseQueryError;

    if ('name' in error && error.name === 'AbortError') {
      return next(action);
    }
    if (httpStatus(error) === HTTP_STATUS.UNAUTHORIZED) {
      const result = next(action);
      if (meta.endpointName !== SESSION_CHECK_ENDPOINT && isSignedIn(getState())) {
        void dispatch(
          authApi.endpoints.getCurrentUser.initiate(undefined, {
            forceRefetch: true,
            subscribe: false,
          }),
        );
      }
      return result;
    }

    const announcement = announcementFor(error);
    if (announcement) {
      announce(announcement);
    }
    return next(action);
  };
