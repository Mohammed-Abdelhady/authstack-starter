/**
 * One enabled provider as listed by GET /api/auth/oauth/providers.
 * The backend registry decides the set, so ids are plain slugs.
 */
export interface OAuthProviderSummary {
  id: string;
  displayName: string;
}

/**
 * A provider id. Values come from the discovery endpoint, never from a
 * hardcoded list, so a new backend provider needs no frontend change.
 */
export type OAuthProvider = OAuthProviderSummary['id'];

/**
 * Payload of the providers endpoint.
 */
export interface OAuthProvidersResponse {
  providers: OAuthProviderSummary[];
}

/**
 * Outcome the backend reports on the client callback URL.
 */
export type OAuthCallbackStatus = 'ok' | 'error';

/**
 * Icon and brand styling for one provider button.
 * Providers without an entry fall back to a neutral button.
 */
export interface OAuthProviderMeta {
  iconPath: string;
  buttonClassName: string;
  hoverClassName: string;
}

export interface OAuthStartRequest {
  providerId: string;
  redirect: string;
  intent: 'login' | 'link';
}
