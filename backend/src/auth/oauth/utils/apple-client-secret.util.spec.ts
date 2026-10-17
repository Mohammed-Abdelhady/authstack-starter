import { decodeJwt, exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import type { CryptoKey } from 'jose';
import {
  APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS,
  createAppleClientSecret,
} from './apple-client-secret.util';

const TEAM_ID = 'ABCDE12345';
const KEY_ID = 'KEY1234567';
const CLIENT_ID = 'com.example.service';

describe('createAppleClientSecret', () => {
  let privateKey: CryptoKey;
  let pem: string;

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256', { extractable: true });
    privateKey = pair.privateKey;
    pem = await exportPKCS8(privateKey);
    // Touch the public half so a failure here points at key generation.
    expect(await exportJWK(pair.publicKey)).toHaveProperty('crv', 'P-256');
  });

  it('clamps the lifetime to the six month ceiling Apple allows', async () => {
    const secret = await createAppleClientSecret({
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: pem,
      clientId: CLIENT_ID,
      expiresInSeconds: APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS * 2,
    });

    const claims = decodeJwt(secret);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(
      APPLE_CLIENT_SECRET_MAX_LIFETIME_SECONDS,
    );
  });

  it('defaults to a secret that outlives only the token request', async () => {
    const secret = await createAppleClientSecret({
      teamId: TEAM_ID,
      keyId: KEY_ID,
      privateKey: pem,
      clientId: CLIENT_ID,
    });

    const claims = decodeJwt(secret);
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(300);
  });
});
