import { createPublicKey, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceKeyPort } from '../../src';
import { FIXED_PUBLIC_JWK, SoftwareDeviceKey } from '../support/software-device-key';
import {
  buildVector,
  buildVectorFile,
  serialize,
  VECTOR_PATH,
  type ProofVector,
  type VectorFile,
} from './dpop-vector.generate';
import stored from '../../../../shared/sdk/test/fixtures/native-dpop-vector.json?raw';

declare const process: { env: Record<string, string | undefined> };

const FILE = JSON.parse(stored) as VectorFile;
/** Empty only while the file is being written for the first time. */
const VECTORS = FILE.vectors ?? [];

const HEADER =
  '{"typ":"dpop+jwt","alg":"ES256","jwk":{"kty":"EC","crv":"P-256","x":"kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394","y":"Dhwd2dUIhY_-YTgJDQNh7VMP7CMF7LhiwZAwaFo17BM","alg":"ES256"}}';
const NONCE = '67849200.D39EiUXtZzXo9pMNtusjSjClHXRY81m6xmkomp9li74';
/** SHA-256 of `refresh-secret-0`, base64url, from `openssl dgst -sha256 -binary`. */
const TOKEN_HASH = 'yK6EyKNSH5RItCpXKrDWeIK6RzWXczHH8o4TS0pCDKI';
const claims = (path: string, ath?: string): string =>
  `{"htm":"POST","htu":"https://api.example.test${path}","iat":4070952000,"jti":"AAECAwQFBgcICQoLDA0ODw","nonce":"${NONCE}"${
    ath === undefined ? '' : `,"ath":"${ath}"`
  }}`;

/** Written by hand: what each request must have signed. */
const EXPECTED = [
  { name: 'code exchange', header: HEADER, payload: claims('/api/oauth/token') },
  { name: 'bound refresh', header: HEADER, payload: claims('/api/oauth/token', TOKEN_HASH) },
  { name: 'bound revoke', header: HEADER, payload: claims('/api/oauth/revoke', TOKEN_HASH) },
];

const signatureOf = (proof: string): Uint8Array =>
  new Uint8Array(Buffer.from(proof.split('.')[2] ?? '', 'base64url'));
const signingInputOf = (proof: string): string => proof.split('.').slice(0, 2).join('.');

/** Hands back the stored signature and keeps what it was asked to sign. */
function replayingKey(vector: ProofVector) {
  const signed: string[] = [];
  const key: DeviceKeyPort = {
    publicKey: async () => ({ kind: 'success', value: FIXED_PUBLIC_JWK }),
    sign: async (data) => {
      signed.push(Buffer.from(data).toString('utf8'));
      return { kind: 'success', value: signatureOf(vector.proof) };
    },
  };
  return { key, signed };
}

describe('the DPoP proof vectors shared with the server', () => {
  it('are written again on request, by the engine with a real key', async () => {
    if (process.env.UPDATE_DPOP_VECTOR !== '1') return;
    writeFileSync(VECTOR_PATH, serialize(await buildVectorFile(new SoftwareDeviceKey())));
  });

  it('hold the fixed inputs and the header and claims each request signs', () => {
    expect({
      format: FILE.format,
      key: FILE.key,
      server: FILE.server,
      vectors: VECTORS.map(({ name, header, payload }) => ({ name, header, payload })),
    }).toEqual({
      format: 1,
      key: {
        publicJwk: {
          kty: 'EC',
          crv: 'P-256',
          x: 'kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394',
          y: 'Dhwd2dUIhY_-YTgJDQNh7VMP7CMF7LhiwZAwaFo17BM',
          alg: 'ES256',
        },
        thumbprint: '2Z-ICOWJ-osZEZ-v5VqCUGhisbZ2H1ilwlEG3R_VECU',
      },
      server: {
        apiOrigin: 'https://api.example.test',
        nonceSecret: 'native-dpop-test-secret-at-least-32-chars',
        nowMs: 4070952000000,
      },
      vectors: EXPECTED,
    });
  });

  it.each(VECTORS)('the engine builds the stored $name proof byte for byte', async (vector) => {
    const { key, signed } = replayingKey(vector);

    const rebuilt = await buildVector(vector, key);

    expect(rebuilt.vector).toEqual(vector);
    expect(rebuilt.thumbprint).toBe(FILE.key.thumbprint);
    expect(signed).toEqual([signingInputOf(vector.proof)]);
  });

  it.each(VECTORS)('the stored $name proof is signed by the stored key', (vector) => {
    const { kty, crv, x, y } = FILE.key.publicJwk;
    const publicKey = createPublicKey({ key: { kty, crv, x, y }, format: 'jwk' });
    const check = (signingInput: string): boolean =>
      verify(
        'sha256',
        new Uint8Array(Buffer.from(signingInput)),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signatureOf(vector.proof),
      );

    expect(signatureOf(vector.proof)).toHaveLength(64);
    expect([
      check(signingInputOf(vector.proof)),
      check(`${signingInputOf(vector.proof)}x`),
    ]).toEqual([true, false]);
  });
});
