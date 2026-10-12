import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { OAuthProviderConfig } from '../../config/oauth.config';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthCallbackMethod,
  OAuthCallbackParams,
  OAuthProfile,
  OAuthProviderStrategy,
  OAuthTokens,
} from './oauth-provider.interface';
import {
  JOSE_ERROR_CODE_PATTERN,
  OAUTH_HTTP_TIMEOUT_MS,
  OAUTH_UNLISTED_PROVIDER_CODE,
  RFC6749_ERROR_CODES,
  OAuthFailureReason,
} from './oauth.constants';

/** Extra facts a failure log may carry, each one gated by the log itself. */
export interface OAuthFailureDetail {
  httpStatus?: number;
  providerCode?: unknown;
  joseCode?: unknown;
}

/** A jose error's machine code, when the thrown value carries one. */
export function joseCodeOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && JOSE_ERROR_CODE_PATTERN.test(code)) {
      return code;
    }
  }
  return undefined;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Shared configuration lookup and HTTP helpers for provider strategies.
 * Provider specific endpoints and payload shapes live in the subclasses.
 */
@Injectable()
export abstract class BaseOAuthStrategy implements OAuthProviderStrategy {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly supportsPkce: boolean;
  abstract readonly usesOidc: boolean;
  abstract readonly emailAlwaysVerified: boolean;
  abstract readonly autoLinksByEmail: boolean;

  /** Providers that post their callback override this with 'POST'. */
  readonly callbackMethod: OAuthCallbackMethod = 'GET';

  protected readonly providerErrorCodes: readonly string[] = [];

  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly configService: ConfigService) {}

  get envPrefix(): string {
    return `OAUTH_${this.id.toUpperCase()}`;
  }

  isEnabled(): boolean {
    return this.providerConfig?.enabled === true;
  }

  abstract getAuthorizationUrl(params: AuthorizationUrlParams): string;

  abstract exchangeCode(params: ExchangeCodeParams): Promise<OAuthTokens>;

  abstract fetchProfile(
    tokens: OAuthTokens,
    callbackParams?: OAuthCallbackParams,
  ): Promise<OAuthProfile>;

  protected get providerConfig(): OAuthProviderConfig | undefined {
    return this.configService.get<OAuthProviderConfig>(
      `oauth.providers.${this.id}`,
    );
  }

  /**
   * Client credentials for this provider.
   *
   * @throws AppException when the provider has no credentials configured
   */
  protected credentials(): OAuthCredentials {
    const config = this.providerConfig;
    if (!config?.clientId || !config.clientSecret) {
      throw new AppException(
        ErrorCode.OAUTH_NOT_CONFIGURED,
        `OAuth provider '${this.id}' is not configured`,
        HttpStatus.SERVICE_UNAVAILABLE,
        { provider: this.id },
      );
    }
    return { clientId: config.clientId, clientSecret: config.clientSecret };
  }

  protected codeExchangeFailed(
    reason: OAuthFailureReason,
    detail: OAuthFailureDetail = {},
  ): AppException {
    const upstreamFailure =
      reason === OAuthFailureReason.NETWORK ||
      reason === OAuthFailureReason.MALFORMED_RESPONSE;
    const code = upstreamFailure
      ? ErrorCode.OAUTH_AUTHENTICATION_FAILED
      : ErrorCode.OAUTH_CODE_INVALID;
    this.logFailure('Code exchange failed', code, reason, detail);
    return new AppException(
      code,
      'Authorization code could not be exchanged',
      upstreamFailure ? HttpStatus.BAD_GATEWAY : HttpStatus.BAD_REQUEST,
      { provider: this.id },
    );
  }

  protected profileFetchFailed(
    reason: OAuthFailureReason,
    detail: OAuthFailureDetail = {},
  ): AppException {
    this.logFailure(
      'Profile fetch failed',
      ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      reason,
      detail,
    );
    return new AppException(
      ErrorCode.OAUTH_AUTHENTICATION_FAILED,
      'Provider profile could not be read',
      HttpStatus.BAD_GATEWAY,
      { provider: this.id },
    );
  }

  /**
   * The log line for an OAuth failure: the closed reason, the HTTP status
   * when there is one, and codes only when the standards define them. Free
   * provider text is never quoted.
   */
  private logFailure(
    head: string,
    code: ErrorCode,
    reason: OAuthFailureReason,
    detail: OAuthFailureDetail,
  ): void {
    const parts = [`reason=${reason}`];
    if (typeof detail.httpStatus === 'number') {
      parts.push(`status=${detail.httpStatus}`);
    }
    if (typeof detail.providerCode === 'string') {
      const listed =
        (RFC6749_ERROR_CODES as readonly string[]).includes(
          detail.providerCode,
        ) || this.providerErrorCodes.includes(detail.providerCode);
      parts.push(
        `providerCode=${listed ? detail.providerCode : OAUTH_UNLISTED_PROVIDER_CODE}`,
      );
    }
    if (
      typeof detail.joseCode === 'string' &&
      JOSE_ERROR_CODE_PATTERN.test(detail.joseCode)
    ) {
      parts.push(`joseCode=${detail.joseCode}`);
    }
    this.logger.warn(`${head} for ${this.id}: ${code} ${parts.join(' ')}`);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    failure: (
      reason: OAuthFailureReason,
      detail?: OAuthFailureDetail,
    ) => AppException,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      if (isAbortOrTimeout(error)) {
        this.logFailure(
          'Provider HTTP timed out',
          ErrorCode.OAUTH_AUTHENTICATION_FAILED,
          OAuthFailureReason.TIMEOUT,
          {},
        );
        throw new AppException(
          ErrorCode.OAUTH_AUTHENTICATION_FAILED,
          'Provider request timed out',
          HttpStatus.BAD_GATEWAY,
          { provider: this.id },
        );
      }
      throw failure(OAuthFailureReason.NETWORK);
    }
  }

  protected async httpGetJson<T>(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const failure = this.profileFetchFailed.bind(this);
    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
      },
      failure,
    );

    if (!response.ok) {
      throw failure(OAuthFailureReason.HTTP_STATUS, {
        httpStatus: response.status,
        providerCode: await readProviderError(response),
      });
    }

    return readJson<T>(response, failure);
  }

  /**
   * POST an application/x-www-form-urlencoded body. Credentials always travel
   * in the body, never in the query string.
   */
  protected async httpPostForm<T>(
    url: string,
    body: Record<string, string>,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const failure = this.codeExchangeFailed.bind(this);
    const response = await this.fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          ...headers,
        },
        body: new URLSearchParams(body).toString(),
      },
      failure,
    );

    if (!response.ok) {
      throw failure(OAuthFailureReason.HTTP_STATUS, {
        httpStatus: response.status,
        providerCode: await readProviderError(response),
      });
    }

    return readJson<T>(response, failure);
  }
}

async function readProviderError(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && 'error' in body
      ? body.error
      : undefined;
  } catch {
    return undefined;
  }
}

async function readJson<T>(
  response: Response,
  failure: (reason: OAuthFailureReason) => AppException,
): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw failure(OAuthFailureReason.MALFORMED_RESPONSE);
  }
}

function isAbortOrTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}
