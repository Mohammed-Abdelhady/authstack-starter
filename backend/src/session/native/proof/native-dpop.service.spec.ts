import {
  resolveNativeDpopAddress,
  resolveNativeDpopTokenAddress,
} from './native-dpop.service';
import {
  NATIVE_DPOP_REVOKE_PATH,
  NATIVE_DPOP_TOKEN_PATH,
} from '../../constants/session-policy';
import { OAUTH_ERROR } from '../oauth/native-oauth.types';
import { validateEnvironment } from '../../../config/env.validation';
import { nativeDpopNonceCandidates } from './native-dpop-nonce';
import { verifyNativeDpopProof } from './native-dpop-proof';
import { signNativeDpopProof } from '../harness/native-dpop-test-vectors.harness-spec';
import { NATIVE_DPOP_TEST_SECRET } from '../persistence/mongo/harness/native-oauth.harness-spec';

describe('native DPoP token address', () => {
  it.each([
    [
      'an origin with a trailing slash',
      'https://api.example.test/',
      'https://api.example.test/api/oauth/token',
    ],
    [
      'an origin with a path prefix',
      'https://api.example.test/gateway',
      'https://api.example.test/gateway/api/oauth/token',
    ],
    [
      'a path prefix ending in a slash',
      'https://api.example.test/gateway/',
      'https://api.example.test/gateway/api/oauth/token',
    ],
  ])('appends the token path to %s', (_label, apiOrigin, expectedAddress) => {
    expect(resolveNativeDpopTokenAddress(apiOrigin)).toBe(expectedAddress);
  });

  it.each([
    [
      'token path after a trailing slash and prefix',
      'https://api.example.test/gateway/',
      NATIVE_DPOP_TOKEN_PATH,
      'https://api.example.test/gateway/api/oauth/token',
    ],
    [
      'revoke path after a trailing slash and prefix',
      'https://api.example.test/gateway/',
      NATIVE_DPOP_REVOKE_PATH,
      'https://api.example.test/gateway/api/oauth/revoke',
    ],
    [
      'token path after a prefix without a slash',
      'https://api.example.test/v2',
      NATIVE_DPOP_TOKEN_PATH,
      'https://api.example.test/v2/api/oauth/token',
    ],
    [
      'revoke path after a prefix without a slash',
      'https://api.example.test/v2',
      NATIVE_DPOP_REVOKE_PATH,
      'https://api.example.test/v2/api/oauth/revoke',
    ],
  ] as const)('resolves the %s', (_label, apiOrigin, path, expectedAddress) => {
    expect(resolveNativeDpopAddress(apiOrigin, path)).toBe(expectedAddress);
  });
});

describe('native DPoP OAuth errors', () => {
  it('uses the protocol error code for a refused proof', () => {
    expect(OAUTH_ERROR.INVALID_DPOP_PROOF).toBe('invalid_dpop_proof');
  });
});

describe('native DPoP proof against the configured API_URL', () => {
  const PROOF_TIME = new Date('2099-01-01T12:00:00.000Z');

  function verifyAgainst(apiUrl: string) {
    const environment = validateEnvironment({
      NODE_ENV: 'production',
      MONGO_URI: 'mongodb://localhost:27017/authboiler',
      CLIENT_URL: 'https://app.example.test',
      OAUTH_STATE_SECRET: 'a'.repeat(32),
      AUTH_NATIVE_ENABLED: 'true',
      AUTH_NATIVE_DPOP_NONCE_SECRET: NATIVE_DPOP_TEST_SECRET,
      API_URL: apiUrl,
    });
    return verifyNativeDpopProof({
      proof: signNativeDpopProof({
        claims: { htu: 'https://api.example.test/api/oauth/token' },
      }),
      expectedMethod: 'POST',
      expectedAddress:
        resolveNativeDpopTokenAddress(environment.API_URL ?? '') ?? '',
      now: PROOF_TIME,
      expectedNonces: nativeDpopNonceCandidates(
        NATIVE_DPOP_TEST_SECRET,
        PROOF_TIME,
      ),
    });
  }

  it('accepts a proof signed for the public address', () => {
    expect(verifyAgainst('https://api.example.test')).toMatchObject({
      ok: true,
      jti: 'dpop-test-proof-id',
    });
  });

  it('refuses the same proof when API_URL names another host', () => {
    expect(verifyAgainst('https://internal.example.test')).toEqual({
      ok: false,
      reason: 'NATIVE_DPOP_PROOF_ADDRESS_MISMATCH',
    });
  });
});
