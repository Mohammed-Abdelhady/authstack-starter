import request, { type Response } from 'supertest';
import { ConfigService } from '@nestjs/config';
import type { ExchangeCodeParams } from '../../src/auth/oauth/oauth-provider.interface';
import { OAuthStateService } from '../../src/auth/oauth/oauth-state.service';
import { ADMIN_CLIENT_ID } from '../../src/session/constants/client-ids';
import type { BrowserApplicationId } from '../../src/session/applications/types/browser-application';
import { reconcileStartupApplications } from '../../src/session/session.module';
import {
  AudienceProvider,
  PROVIDER_ID,
} from '../utils/auth/audience-provider.fixture';
import { anonymousPost } from '../utils/auth/audience-refusal.fixtures';
import { ADMIN_ORIGIN } from '../utils/audience-authorization.fixtures';
import { cookiePair } from '../utils/browser-applications.fixtures';
import { RaceGate } from '../utils/race-gate';
import type { E2eApp, TestAgent } from '../utils/e2e-app';

export const PROVIDER_START = `/api/auth/oauth/${PROVIDER_ID}/start`;
export const PROVIDER_CALLBACK = `/api/auth/oauth/${PROVIDER_ID}/callback`;

export class HeldPolicyProvider extends AudienceProvider {
  gate: RaceGate | undefined;
  exchanges = 0;
  override async exchangeCode(params: ExchangeCodeParams) {
    this.exchanges += 1;
    await this.gate?.hold();
    return super.exchangeCode(params);
  }
}

export async function setProviderPolicy(
  e2e: E2eApp,
  enabled: boolean,
): Promise<void> {
  e2e.app.get(ConfigService).set('auth.admin.signIn', {
    audience: 'staff',
    signUp: 'closed',
    oauth: enabled,
  });
  await reconcileStartupApplications(e2e.app);
}

export async function startPolicyProvider(
  e2e: E2eApp,
  provider: AudienceProvider,
  options: {
    browser?: TestAgent;
    origin?: string;
    clientId?: BrowserApplicationId;
  } = {},
) {
  const browser = options.browser ?? request.agent(e2e.httpServer);
  const response = await anonymousPost(
    e2e,
    PROVIDER_START,
    {},
    browser,
    options.origin ?? ADMIN_ORIGIN,
  );
  expect(response.status).toBe(201);
  const cookieName = e2e.app
    .get(OAuthStateService)
    .cookieName(PROVIDER_ID, options.clientId ?? ADMIN_CLIENT_ID);
  return {
    browser,
    state: provider.state,
    cookie: cookiePair(response, cookieName),
  };
}

export function finishPolicyProvider(
  ceremony: Awaited<ReturnType<typeof startPolicyProvider>>,
): Promise<Response> {
  return ceremony.browser
    .get(PROVIDER_CALLBACK)
    .set('Cookie', ceremony.cookie)
    .query({ state: ceremony.state, code: 'accepted-external-code' })
    .redirects(0)
    .then((response) => response);
}
