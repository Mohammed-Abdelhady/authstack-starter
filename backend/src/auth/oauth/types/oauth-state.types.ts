import type { BrowserApplicationId } from '../../../session/applications/types/browser-application';

export interface OAuthStatePayload {
  state: string;
  codeVerifier?: string;
  nonce?: string;
  redirect: string;
  expiresAt: number;
  intent: 'login' | 'link';
  linkUserId?: string;
  linkSessionId?: string;
  clientId: BrowserApplicationId;
  returnBase: string;
}

export interface OAuthStateRequest {
  redirect: string;
  supportsPkce: boolean;
  usesOidc: boolean;
  intent?: 'login' | 'link';
  linkUserId?: string;
  linkSessionId?: string;
  clientId?: BrowserApplicationId;
  returnBase?: string;
}

export interface OAuthStateCreation {
  payload: OAuthStatePayload;
  codeChallenge?: string;
}
