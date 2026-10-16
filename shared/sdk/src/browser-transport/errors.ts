import { ErrorCode } from '@app/core/errors';
import { ApiError, SdkError } from '../errors';
import type { BrowserParsingFailure, BrowserResponse } from './types';

const UNKNOWN_OUTCOME_BRAND = Symbol.for('@app/sdk/UnknownOutcomeError');
const STALE_RESPONSE_BRAND = Symbol.for('@app/sdk/StaleResponseError');

export class UnknownOutcomeError extends SdkError {
  readonly operationKey: string | undefined;
  readonly status: number | undefined;
  readonly parsingError: BrowserParsingFailure | undefined;
  readonly unknownOutcome = true;
  readonly retryable = false;

  constructor(
    operationKey?: string,
    options?: { cause?: unknown; status?: number; parsingError?: BrowserParsingFailure },
  ) {
    super('The write outcome is unknown', options);
    this.name = 'UnknownOutcomeError';
    this.operationKey = operationKey;
    this.status = options?.status;
    this.parsingError = options?.parsingError;
    Object.defineProperty(this, UNKNOWN_OUTCOME_BRAND, { value: true });
  }
}

export class StaleResponseError extends SdkError {
  readonly response: BrowserResponse | undefined;

  constructor(response?: BrowserResponse, options?: { cause?: unknown }) {
    super('The identity response is stale', options);
    this.name = 'StaleResponseError';
    this.response = response;
    Object.defineProperty(this, STALE_RESPONSE_BRAND, { value: true });
  }
}

export class BrowserApiError extends ApiError {
  readonly responseBody: unknown;
  readonly unknownOutcome: boolean;

  constructor(error: ApiError, responseBody: unknown, unknownOutcome = false) {
    super(error);
    this.responseBody = responseBody;
    this.unknownOutcome = unknownOutcome;
  }
}

export class BrowserParseError extends ApiError {
  readonly parsingError: BrowserParsingFailure;

  constructor(parsingError: BrowserParsingFailure) {
    super({
      status: parsingError.originalStatus,
      code: ErrorCode.UNKNOWN_ERROR,
      message: parsingError.error,
    });
    this.name = 'BrowserParseError';
    this.parsingError = parsingError;
  }
}

export function isUnknownOutcomeError(error: unknown): error is UnknownOutcomeError {
  return typeof error === 'object' && error !== null && UNKNOWN_OUTCOME_BRAND in error;
}

export function isStaleResponseError(error: unknown): error is StaleResponseError {
  return typeof error === 'object' && error !== null && STALE_RESPONSE_BRAND in error;
}
