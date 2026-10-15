import { BROWSER_APPLICATION_ROUTES } from '../../session/constants/browser-application-routes';
import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { sanitizeRedirectPath } from '../../common/utils/redirect.util';
import { requestLocaleOf } from '../../common/decorators/request-locale.decorator';
import { WEB_CLIENT_ID } from '../../session/constants/client-ids';
import { BrowserApplications } from '../../session/applications/browser-applications';
import { OAuthRegistryService } from './oauth-registry.service';
import { OAuthStateService } from './oauth-state.service';
import { OAuthService } from './oauth.service';
import { OAuthRedirectService } from './oauth-redirect.service';
import type { OAuthCallbackParams } from './oauth-provider.interface';
import type { OAuthStatePayload } from './types/oauth-state.types';
import type { BrowserOAuthStart } from './types/browser-oauth-start';
import type { BrowserApplicationId } from '../../session/applications/types/browser-application';
import { toCallbackParams } from './utils/callback-params.util';

@Injectable()
export class BrowserOAuthFlow implements OnModuleInit {
  constructor(
    private readonly registry: OAuthRegistryService,
    private readonly state: OAuthStateService,
    private readonly oauth: OAuthService,
    private readonly redirects: OAuthRedirectService,
    private readonly applications: BrowserApplications,
  ) {}

  onModuleInit(): void {
    this.applications.registerCeremonyReader('oauth', (request) =>
      Promise.resolve(this.ceremonyApplication(request)),
    );
  }

  private ceremonyApplication(
    request: Request,
  ): BrowserApplicationId | undefined {
    if (
      request.method === 'GET' &&
      BROWSER_APPLICATION_ROUTES.OAUTH_START.test(request.path)
    ) {
      return WEB_CLIENT_ID;
    }
    const match = BROWSER_APPLICATION_ROUTES.OAUTH_CALLBACK.exec(request.path);
    if (!match) return undefined;
    const params = toCallbackParams(
      request.method === 'POST' ? request.body : request.query,
    );
    try {
      return this.state.readCallback(request, match[1], params.state).clientId;
    } catch (error) {
      if (
        error instanceof AppException &&
        error.getCode() === ErrorCode.OAUTH_STATE_INVALID
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async start(input: BrowserOAuthStart): Promise<string> {
    const application = input.clientId
      ? await this.applications.remember(input.request, input.clientId)
      : await this.applications.resolve(input.request);
    this.applications.assertEnabled(application);
    const strategy = this.registry.getEnabled(input.providerId);
    const linking = input.intent === 'link';
    const linked = linking
      ? await this.oauth.requireSession(input.request)
      : undefined;
    const { payload, codeChallenge } = this.state.create({
      clientId: application.clientId,
      returnBase: application.returnBase,
      redirect: sanitizeRedirectPath(input.redirect),
      supportsPkce: strategy.supportsPkce,
      usesOidc: strategy.usesOidc,
      intent: linking ? 'link' : 'login',
      linkUserId: linked?.userId,
      linkSessionId: linked?.sessionId,
    });
    const url = strategy.getAuthorizationUrl({
      state: payload.state,
      redirectUri: this.registry.getCallbackUrl(strategy.id),
      codeChallenge,
      nonce: payload.nonce,
    });
    this.state.write(
      input.response,
      strategy.id,
      payload,
      strategy.callbackMethod === 'POST',
    );
    return url;
  }

  startError(response: Response, error: unknown, providerId: string): void {
    this.redirects.toClientError(response, error, providerId);
  }

  async callback(
    providerId: string,
    params: OAuthCallbackParams,
    request: Request,
    response: Response,
  ): Promise<void> {
    let payload: OAuthStatePayload | undefined;
    try {
      const strategy = this.registry.getEnabled(providerId);
      payload = this.state.readCallback(request, strategy.id, params.state);
      const application = await this.applications.remember(
        request,
        payload.clientId,
      );
      this.applications.assertEnabled(application);
      if (params.error || !params.code) {
        throw new AppException(
          params.error
            ? ErrorCode.OAUTH_AUTHENTICATION_FAILED
            : ErrorCode.OAUTH_CODE_INVALID,
          params.error
            ? 'OAuth provider refused authentication'
            : 'Authorization code is missing',
          params.error ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_REQUEST,
          { provider: strategy.id },
        );
      }
      const shared = {
        strategy,
        code: params.code,
        redirectUri: this.registry.getCallbackUrl(strategy.id),
        codeVerifier: payload.codeVerifier,
        nonce: payload.nonce,
        callbackParams: params,
        response,
        locale: requestLocaleOf(request),
        clientId: payload.clientId,
      };
      if (payload.intent === 'link') {
        if (!payload.linkUserId || !payload.linkSessionId) {
          throw new AppException(
            ErrorCode.OAUTH_STATE_INVALID,
            'Missing linking session',
            HttpStatus.UNAUTHORIZED,
          );
        }
        await this.oauth.link({
          ...shared,
          linkUserId: payload.linkUserId,
          linkSessionId: payload.linkSessionId,
        });
        this.state.clear(response, strategy.id, payload);
        this.redirects.toClientSuccess(
          response,
          payload.redirect,
          payload.returnBase,
        );
        return;
      }
      const outcome = await this.oauth.login(shared);
      this.state.clear(response, strategy.id, payload);
      if (outcome.requiresTwoFactor) {
        this.redirects.toTwoFactorChallenge(
          response,
          payload.redirect,
          payload.returnBase,
        );
        return;
      }
      this.redirects.toClientSuccess(
        response,
        payload.redirect,
        payload.returnBase,
      );
    } catch (error) {
      this.state.clear(response, providerId, payload);
      this.redirects.toClientError(
        response,
        error,
        providerId,
        payload?.redirect,
        payload?.returnBase,
      );
    }
  }
}
