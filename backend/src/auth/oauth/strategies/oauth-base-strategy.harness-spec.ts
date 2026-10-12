import { BaseOAuthStrategy } from '../base-oauth.strategy';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  AuthorizationUrlParams,
  ExchangeCodeParams,
  OAuthCallbackParams,
  OAuthProfile,
  OAuthTokens,
} from '../oauth-provider.interface';

/**
 * A local stub: the OAuth core is always present, the concrete strategies
 * are feature-owned and must not be imported into an always-present spec.
 */
export class ProbeStrategy extends BaseOAuthStrategy {
  readonly id = 'probe';
  readonly displayName = 'Probe';
  readonly supportsPkce = false;
  readonly usesOidc = false;
  readonly emailAlwaysVerified = true;
  readonly autoLinksByEmail = true;

  getAuthorizationUrl(_params: AuthorizationUrlParams): string {
    return 'https://probe.example/authorize';
  }

  exchangeCode(_params: ExchangeCodeParams): Promise<OAuthTokens> {
    return this.httpPostForm('https://probe.example/token', {});
  }

  fetchProfile(_tokens: OAuthTokens): Promise<OAuthProfile> {
    return this.httpGetJson('https://probe.example/profile');
  }

  parseCallback(params: OAuthCallbackParams): OAuthCallbackParams {
    return params;
  }

  exchangeFailure(
    reason: Parameters<BaseOAuthStrategy['codeExchangeFailed']>[0],
    detail?: Parameters<BaseOAuthStrategy['codeExchangeFailed']>[1],
  ): AppException {
    return this.codeExchangeFailed(reason, detail);
  }

  profileFailure(
    reason: Parameters<BaseOAuthStrategy['profileFetchFailed']>[0],
    detail?: Parameters<BaseOAuthStrategy['profileFetchFailed']>[1],
  ): AppException {
    return this.profileFetchFailed(reason, detail);
  }
}
