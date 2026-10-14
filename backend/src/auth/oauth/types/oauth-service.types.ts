import { Response } from 'express';
import type { SupportedLocale } from '../../../common/constants/locales';
import {
  OAuthCallbackParams,
  OAuthProviderStrategy,
} from '../oauth-provider.interface';

export interface OAuthLoginParams {
  strategy: OAuthProviderStrategy;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
  nonce?: string;
  /** Raw callback parameters, for providers that ship profile data with them. */
  callbackParams?: OAuthCallbackParams;
  response: Response;
  /** The callback request's language, stored on an account it creates. */
  locale: SupportedLocale;
}

export interface OAuthLinkParams extends OAuthLoginParams {
  linkUserId: string;
  linkSessionId: string;
}

export interface LinkingSession {
  userId: string;
  sessionId: string;
}

export type LinkingProvider = Pick<
  OAuthProviderStrategy,
  'id' | 'autoLinksByEmail'
>;
