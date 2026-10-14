import type { NativePasskeyAssertion, NativeProviderCredential } from '@app/sdk';
import type { NativePromptResult } from '../../src';
import { createAuthEngine } from '../support/engine';
import { CONFIG, Deferred, ScriptedTransport, apiReply, testPorts } from '../support/support';
import {
  ATTEMPT_ID,
  NONCE_DIGEST,
  secondFactorReply,
  startReply,
  TEMPORARY_PASSWORD,
} from './native-fixtures';
import { GOOGLE_METHODS } from './native-methods-fixtures';

export const NETWORK_TIMEOUT_MS = 15_000;
export const INTERACTIVE_KIND = ['provider', 'passkey', 'mfaPasskey'] as const;
export const PASSKEY_ASSERTION: NativePasskeyAssertion = {
  id: 'credential-id',
  rawId: 'raw-id',
  type: 'public-key',
  response: {
    clientDataJSON: 'client-json',
    authenticatorData: 'auth-data',
    signature: 'signature',
  },
};
export const PROVIDER_CREDENTIAL: NativeProviderCredential = {
  kind: 'googleIdentityToken',
  identityToken: 'real-id-token',
  nonceDigest: NONCE_DIGEST,
};

export async function interactiveScenario(
  kind: (typeof INTERACTIVE_KIND)[number],
  lifetimeMs = 10 * 60_000,
) {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const expiresAt = new Date(ports.clock.wall + lifetimeMs).toISOString();
  const provider = new Deferred<NativePromptResult<NativeProviderCredential>>();
  const passkey = new Deferred<NativePromptResult<NativePasskeyAssertion>>();
  const prompted = new Deferred<void>();
  const counts = { provider: 0, passkey: 0 };
  const availability = { provider: async () => true, passkey: async () => true };
  transport.respond = async (request) => {
    if (request.path.endsWith('/attempts')) return startReply(expiresAt);
    if (request.path.includes('/methods')) return apiReply(GOOGLE_METHODS);
    if (kind === 'mfaPasskey' && request.path.endsWith('/password'))
      return apiReply({
        attemptId: ATTEMPT_ID,
        stage: 'secondFactorRequired',
        expiresAt,
        factors: ['passkey'],
      });
    if (request.path.endsWith('/passkey/options'))
      return apiReply({ challenge: 'challenge-value', rpId: 'example.test' });
    return secondFactorReply(expiresAt);
  };
  const engine = createAuthEngine(CONFIG, {
    ...ports,
    providerSignIn: {
      available: () => availability.provider(),
      authenticate: () => {
        counts.provider += 1;
        prompted.resolve();
        return provider.promise;
      },
    },
    passkeys: {
      available: () => availability.passkey(),
      authenticate: () => {
        counts.passkey += 1;
        prompted.resolve();
        return passkey.promise;
      },
    },
  });
  await engine.restore();
  await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
  if (kind === 'mfaPasskey') {
    await engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: TEMPORARY_PASSWORD,
    });
  }
  const action =
    kind === 'provider'
      ? { kind: 'provider' as const, providerId: 'google' }
      : { kind: 'passkey' as const };
  const complete = (success: boolean) => {
    provider.resolve(
      success ? { kind: 'success', value: PROVIDER_CREDENTIAL } : { kind: 'cancelled' },
    );
    passkey.resolve(
      success ? { kind: 'success', value: PASSKEY_ASSERTION } : { kind: 'cancelled' },
    );
  };
  return { engine, ports, transport, action, prompted, counts, complete, expiresAt, availability };
}
