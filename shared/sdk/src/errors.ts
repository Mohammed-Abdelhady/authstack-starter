export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string[]> | undefined;
  requestId?: string | undefined;
}

const SDK_ERROR_BRAND = Symbol.for('@app/sdk/SdkError');

export function isSdkError(error: unknown): error is SdkError {
  return (
    typeof error === 'object' &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, SDK_ERROR_BRAND)
  );
}

/** Base class for errors the SDK client preserves across transport boundaries. */
export class SdkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SdkError';
    Object.defineProperty(this, SDK_ERROR_BRAND, { value: true });
  }
}

/** A response arrived and it was not a success. */
export class ApiError extends SdkError {
  readonly status: number;
  /** An `@app/core` error code from the body, or one mapped from the status. */
  readonly code: string;
  /** Messages per field, on a validation error. */
  readonly fields?: Record<string, string[]> | undefined;
  readonly requestId?: string | undefined;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.fields = init.fields;
    this.requestId = init.requestId;
  }
}

export interface OAuthErrorInit {
  status: number;
  error: string;
  errorDescription?: string | undefined;
  dpopNonce?: string | undefined;
}

/** A raw OAuth route refused the request with `{ error }`. */
export class OAuthError extends SdkError {
  readonly status: number;
  /** The OAuth error string, one of `OAUTH_ERROR` for this server. */
  readonly error: string;
  /** The `error_description` the server sent, when it sent a string. */
  readonly errorDescription?: string | undefined;
  /** The DPoP-Nonce response header on a nonce challenge, when present. */
  readonly dpopNonce?: string | undefined;

  constructor(init: OAuthErrorInit) {
    super(init.error);
    this.name = 'OAuthError';
    this.status = init.status;
    this.error = init.error;
    this.errorDescription = init.errorDescription;
    this.dpopNonce = init.dpopNonce;
  }
}
