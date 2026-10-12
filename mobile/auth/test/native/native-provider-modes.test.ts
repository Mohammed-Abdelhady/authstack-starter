import { describe, expect, it } from 'vitest';
import type { NativeProviderCredential } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import { apiReply, CONFIG, ScriptedTransport, testPorts } from '../support/support';
import { ATTEMPT_ID, NONCE_DIGEST, startReply } from './native-fixtures';

const providerCases: {
  providerId: string;
  mode: 'appleIdentityTokenAndCode' | 'facebook';
  sdk: { kind: 'apple' | 'facebook'; appId: string };
  credential: NativeProviderCredential;
  secretValue: string;
}[] = [
  {
    providerId: 'apple',
    mode: 'appleIdentityTokenAndCode',
    sdk: { kind: 'apple', appId: 'apple-app' },
    credential: {
      kind: 'appleIdentityTokenAndCode',
      identityToken: 'apple-id-token',
      authorizationCode: 'apple-code',
      nonceDigest: NONCE_DIGEST,
    },
    secretValue: 'apple-id-token',
  },
  {
    providerId: 'facebook',
    mode: 'facebook',
    sdk: { kind: 'facebook', appId: 'facebook-app' },
    credential: {
      kind: 'facebookLimitedToken',
      authenticationToken: 'limited-token',
      nonceDigest: NONCE_DIGEST,
    },
    secretValue: 'limited-token',
  },
  {
    providerId: 'facebook',
    mode: 'facebook',
    sdk: { kind: 'facebook', appId: 'facebook-app' },
    credential: { kind: 'facebookAccessToken', accessToken: 'classic-token' },
    secretValue: 'classic-token',
  },
];

describe('native provider SDK modes', () => {
  it.each(providerCases)(
    'submits the real $credential.kind artifact for $providerId',
    async ({ providerId, mode, sdk, credential, secretValue }) => {
      const transport = new ScriptedTransport();
      const base = testPorts(transport);
      const expiresAt = new Date(base.clock.wall + 10 * 60_000).toISOString();
      const ports = {
        ...base,
        providerSignIn: {
          available: async () => true,
          authenticate: async () => ({ kind: 'success' as const, value: credential }),
        },
      };
      transport.enqueue(
        startReply(expiresAt),
        apiReply({
          nativeEnabled: true,
          methods: {
            password: false,
            magicLink: false,
            twoFactor: true,
            passkeys: false,
            oauth: [{ id: providerId, displayName: providerId }],
          },
          capabilities: {
            password: false,
            emailLink: false,
            passkeys: false,
            registration: false,
            recovery: false,
          },
          providers: [{ id: providerId, displayName: providerId, mode, sdk }],
        }),
        apiReply({
          attemptId: ATTEMPT_ID,
          stage: 'secondFactorRequired',
          expiresAt,
          factors: ['totp'],
        }),
      );
      const engine = createAuthEngine(CONFIG, ports);
      await engine.restore();
      await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });

      const result = await engine.nativeSignIn({ kind: 'provider', providerId });

      expect(result.kind).toBe('continue');
      expect(transport.sent[2].body).toEqual(credential);
      expect(base.credentials.value).not.toContain(secretValue);
    },
  );
});
