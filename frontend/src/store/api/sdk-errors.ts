import {
  ApiError,
  BrowserApiError,
  BrowserParseError,
  TransportError,
  UnknownOutcomeError,
  TRANSPORT_FAILURE,
  isSdkError,
  requireHttpSuccess,
  type BrowserParsingFailure,
  type StaleResponseError,
} from '@app/sdk';
import { HTTP_STATUS } from '@/constants/httpStatus';
import type { BrowserQueryError, BrowserQueryResult } from './types/sdk-errors';

function serializedApiError(error: ApiError): BrowserQueryError {
  const data =
    error instanceof BrowserApiError
      ? error.responseBody
      : {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: { fields: error.fields },
          },
          requestId: error.requestId,
        };
  return {
    status: error.status,
    data,
    code: error.code,
    fields: error.fields,
    requestId: error.requestId,
    ...(error instanceof BrowserApiError
      ? { unknownOutcome: error.unknownOutcome }
      : error.status < HTTP_STATUS.INTERNAL_SERVER_ERROR
        ? { unknownOutcome: false }
        : {}),
  };
}

function serializedParsingError(failure: BrowserParsingFailure): BrowserQueryError {
  return {
    status: 'PARSING_ERROR',
    originalStatus: failure.originalStatus,
    data: failure.data,
    error: failure.error,
    unknownOutcome: failure.unknownOutcome,
    ...(failure.operationKey === undefined ? {} : { operationKey: failure.operationKey }),
  };
}

export function serializeSdkError(error: unknown): BrowserQueryError {
  if (error instanceof BrowserParseError) return serializedParsingError(error.parsingError);
  if (error instanceof UnknownOutcomeError && error.parsingError) {
    return serializedParsingError(error.parsingError);
  }
  if (error instanceof ApiError) return serializedApiError(error);
  if (error instanceof UnknownOutcomeError) {
    const serialized = {
      error: error.message,
      code: 'UNKNOWN_OUTCOME',
      operationKey: error.operationKey,
      unknownOutcome: true,
    };
    return typeof error.status === 'number'
      ? { ...serialized, status: error.status, data: undefined }
      : { ...serialized, status: 'FETCH_ERROR' };
  }
  const cancelled = error instanceof TransportError && error.reason === TRANSPORT_FAILURE.ABORTED;
  const prerequisite = isSdkError(error) && !(error instanceof TransportError);
  return {
    status: cancelled || prerequisite ? 'CUSTOM_ERROR' : 'FETCH_ERROR',
    error: error instanceof Error ? error.message : String(error),
    ...(cancelled ? { code: 'REQUEST_ABORTED' } : {}),
    unknownOutcome: false,
  };
}

export function restoreStaleResponse(error: StaleResponseError): BrowserQueryResult {
  const response = error.response;
  if (!response) return { error: serializeSdkError(error.cause) };
  try {
    return { data: requireHttpSuccess(response).body };
  } catch (originalError) {
    return { error: serializeSdkError(originalError) };
  }
}
