import request, { type Response } from 'supertest';
import { createSoftwareAuthenticator } from '../../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { WEB_CLIENT_ID } from '../../../src/session/constants/client-ids';
import { storeBrowserPolicy } from '../session/store-browser-policy';
import { SEED_USER } from '../../constants/seed-users';
import { E2E_CLIENT_URL, type E2eApp, type TestAgent } from '../e2e-app';
import { anonymousPost } from './audience-refusal.fixtures';
import { ConfigService } from '@nestjs/config';
import { SecondFactorStore } from '../../../src/auth/two-factor/stores/second-factor.store';
import { TotpSecretCryptoService } from '../../../src/auth/two-factor/services/totp-secret-crypto.service';
import { OAuthStateService } from '../../../src/auth/oauth/oauth-state.service';
import { AudienceProvider } from './audience-provider.fixture';

export function webPost(
  e2e: E2eApp,
  path: string,
  body: object,
  browser: TestAgent = request.agent(e2e.httpServer),
): Promise<Response> {
  return anonymousPost(e2e, path, body, browser, E2E_CLIENT_URL);
}

export async function requireWebPasskey(e2e: E2eApp): Promise<void> {
  await storeBrowserPolicy(e2e, WEB_CLIENT_ID, { requirePasskey: true });
}

export async function storeExistingPasskey(e2e: E2eApp): Promise<void> {
  const key = createSoftwareAuthenticator(Buffer.from('required-passkey-key'));
  await e2e.state.auth.storePasskey(SEED_USER.email, {
    credentialId: key.credentialId,
    publicKey: key.cosePublicKey,
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    name: 'Required key',
    lastUsedAt: null,
  });
}

export async function oweSecondFactor(e2e: E2eApp): Promise<void> {
  const config = e2e.app.get(ConfigService);
  config.set('twoFactor.enabled', true);
  config.set('twoFactor.encryptionKey', Buffer.alloc(32, 7).toString('base64'));
  const userId = await e2e.state.accounts.accountIdFor(SEED_USER.email);
  if (!userId) throw new Error('Seed account is missing');
  const factors = e2e.app.get(SecondFactorStore);
  const account = await factors.findAccount(userId);
  if (!account) throw new Error('Second-factor account is missing');
  const secret = e2e.app
    .get(TotpSecretCryptoService)
    .encrypt('JBSWY3DPEHPK3PXP');
  await factors.savePendingSecret(account, secret);
  const pending = await factors.findAccount(userId);
  if (!pending) throw new Error('Pending second-factor account is missing');
  await factors.saveConfirmation(pending, {
    recoveryCodeHashes: [],
    confirmedAt: e2e.clock.now(),
  });
  expect((await factors.findAccount(userId))?.twoFactor.enabled).toBe(true);
}

export async function webProviderCallback(
  e2e: E2eApp,
  provider: AudienceProvider,
  code = 'accepted-provider-code',
): Promise<Response> {
  provider.email = SEED_USER.email;
  const browser = request.agent(e2e.httpServer);
  const started = await webPost(
    e2e,
    `/api/auth/oauth/${provider.id}/start`,
    {},
    browser,
  );
  expect(started.status).toBe(201);
  const name = e2e.app
    .get(OAuthStateService)
    .cookieName(provider.id, WEB_CLIENT_ID);
  const written: unknown = started.headers['set-cookie'];
  const cookie = (Array.isArray(written) ? written.map(String) : []).find(
    (value) => value.startsWith(`${name}=`),
  );
  if (!cookie) throw new Error('OAuth start wrote no web state cookie');
  return request(e2e.httpServer)
    .get(`/api/auth/oauth/${provider.id}/callback`)
    .set('Cookie', cookie.split(';')[0])
    .query({ state: provider.state, code })
    .redirects(0);
}
