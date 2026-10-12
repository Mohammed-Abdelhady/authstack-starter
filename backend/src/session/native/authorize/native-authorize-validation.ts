import { HttpStatus } from '@nestjs/common';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { ApplicationRegistry } from '../../applications/application-registry';
import { isPkceVerifier } from '../../utils/oauth/pkce';
import { isValidAuthorizeQueryShape } from './native-authorize-query.util';
import type { ValidatedNativeAuthorization } from '../types/native-authorization';
import {
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
} from '../../constants/client-ids';
import { RegisteredClient } from '../../applications/application-registry.store';
import {
  isAcceptableRedirectUri,
  matchesRegisteredRedirectUri,
} from '../../utils/oauth/redirect-uri.util';
import {
  OAUTH_ERROR,
  OauthFailure,
  oauthFailure,
} from '../oauth/native-oauth.types';

export function rejectNativeClient(
  application: RegisteredClient | null,
  redirectUri: string,
  authEpoch: AuthEpochService,
): OauthFailure | null {
  if (
    !application ||
    !application.enabled ||
    application.platform !== APPLICATION_PLATFORM.NATIVE ||
    application.clientType !== APPLICATION_CLIENT_TYPE.PUBLIC
  ) {
    return oauthFailure(
      HttpStatus.BAD_REQUEST,
      OAUTH_ERROR.UNAUTHORIZED_CLIENT,
    );
  }
  if (
    !isAcceptableRedirectUri(redirectUri, {
      nodeEnv: authEpoch.environment(),
      allowCustomScheme: authEpoch.nativeCustomSchemeAllowed(),
    }) ||
    !application.redirectUris.some((registered) =>
      matchesRegisteredRedirectUri(registered, redirectUri),
    )
  ) {
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
  }
  return null;
}

export function resolveNativeScopes(
  application: RegisteredClient | null,
  requested: string | undefined,
): string[] | null {
  if (!application) return null;
  const allowed = new Set(application.allowedScopes);
  if (!requested || requested.trim().length === 0)
    return [...application.allowedScopes];
  const scopes = requested.split(' ').filter((scope) => scope.length > 0);
  return scopes.length > 0 && scopes.every((scope) => allowed.has(scope))
    ? scopes
    : null;
}

const STATE_MAX_LENGTH = 512;

export async function validateNativeAuthorizationRequest(
  query: unknown,
  registry: ApplicationRegistry,
  authEpoch: AuthEpochService,
): Promise<ValidatedNativeAuthorization | OauthFailure> {
  if (!isValidAuthorizeQueryShape(query)) {
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
  }
  if (!authEpoch.nativeEnabled()) {
    return oauthFailure(
      HttpStatus.BAD_REQUEST,
      OAUTH_ERROR.UNAUTHORIZED_CLIENT,
      ErrorCode.NATIVE_AUTH_DISABLED,
    );
  }
  if (query.response_type !== 'code') {
    return oauthFailure(
      HttpStatus.BAD_REQUEST,
      OAUTH_ERROR.UNSUPPORTED_RESPONSE_TYPE,
    );
  }
  const clientId = query.client_id.trim();
  const redirectUri = query.redirect_uri;
  const challenge = query.code_challenge;
  if (
    !clientId ||
    !redirectUri ||
    query.code_challenge_method !== 'S256' ||
    !isPkceVerifier(challenge)
  ) {
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
  }
  const state = query.state;
  if (state.length > STATE_MAX_LENGTH) {
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_REQUEST);
  }

  const application = await registry.lookUpClient(clientId);
  const clientError = rejectNativeClient(application, redirectUri, authEpoch);
  if (clientError) {
    return clientError;
  }
  const scopes = resolveNativeScopes(application, query.scope);
  if (!scopes) {
    return oauthFailure(HttpStatus.BAD_REQUEST, OAUTH_ERROR.INVALID_SCOPE);
  }

  return {
    clientId,
    redirectUri,
    codeChallenge: challenge,
    state,
    requestedScopes: scopes,
  };
}
