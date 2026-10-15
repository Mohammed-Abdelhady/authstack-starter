// feature:oauth-core:start
import request, { type Response } from 'supertest';
import {
  type AuthorizationUrlParams,
  type ExchangeCodeParams,
  type OAuthProfile,
  type OAuthProviderStrategy,
} from '../../../src/auth/oauth/oauth-provider.interface';
import { OAuthStateService } from '../../../src/auth/oauth/oauth-state.service';
import { ADMIN_CLIENT_ID } from '../../../src/session/constants/client-ids';
import type { E2eApp } from '../e2e-app';
import { anonymousPost } from './audience-refusal.fixtures';

export const PROVIDER_ID = 'google';
export const BAD_PROVIDER_CODE = 'bad-provider-code';

/** The provider is the only replaced boundary; the callback and persistence are real. */
export class AudienceProvider implements OAuthProviderStrategy {
  readonly id = PROVIDER_ID;
  readonly displayName = 'Google';
  readonly envPrefix = 'OAUTH_GOOGLE';
  readonly supportsPkce = true;
  readonly usesOidc = false;
  readonly emailAlwaysVerified = true;
  readonly autoLinksByEmail = true;
  readonly callbackMethod = 'GET' as const;
  state = '';
  email = '';

  isEnabled(): boolean {
    return true;
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    this.state = params.state;
    return 'https://provider.example/authorize';
  }

  exchangeCode(params: ExchangeCodeParams) {
    if (params.code === BAD_PROVIDER_CODE) {
      return Promise.reject(new Error('Provider refused the code'));
    }
    return Promise.resolve({ accessToken: 'external-provider-token' });
  }

  fetchProfile(): Promise<OAuthProfile> {
    return Promise.resolve({
      providerId: `provider:${this.email}`,
      email: this.email,
      emailVerified: true,
      name: 'Provider Account',
      avatarUrl: 'https://provider.example/new-avatar.png',
    });
  }
}

export async function providerCallback(
  e2e: E2eApp,
  provider: AudienceProvider,
  email: string,
  code = 'accepted-provider-code',
): Promise<Response> {
  provider.email = email;
  const started = await anonymousPost(
    e2e,
    `/api/auth/oauth/${PROVIDER_ID}/start`,
    {},
  );
  expect(started.status).toBe(201);
  const cookieName = e2e.app
    .get(OAuthStateService)
    .cookieName(PROVIDER_ID, ADMIN_CLIENT_ID);
  const written: unknown = started.headers['set-cookie'];
  const cookie = (Array.isArray(written) ? written.map(String) : []).find(
    (value) => value.startsWith(`${cookieName}=`),
  );
  if (!cookie) throw new Error('OAuth start wrote no admin state cookie');
  return request(e2e.httpServer)
    .get(`/api/auth/oauth/${PROVIDER_ID}/callback`)
    .set('Cookie', cookie.split(';')[0])
    .query({ state: provider.state, code })
    .redirects(0);
}

export function providerReply(response: Response) {
  return {
    status: response.status,
    body: response.text,
    location: response.headers.location as string | undefined,
  };
}
// feature:oauth-core:end
