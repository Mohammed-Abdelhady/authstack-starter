import {
  createHash,
  createPrivateKey,
  sign,
  type JsonWebKey,
} from 'node:crypto';

export const NATIVE_DPOP_TEST_SECRET =
  'native-dpop-test-secret-at-least-32-chars';
export const NATIVE_PUBLIC_API_ORIGIN = 'https://api.example.test';

export const DPOP_TEST_PUBLIC_KEY_A: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'g6cu1Kkpj7sw0wpVVZZDG-HQV3So47V8nPMiU456Vkc',
  y: 'L2e8_qdvsmO3wFSdDIFrAkFCCHbsQe9gIwZggPakYeg',
};

export const DPOP_TEST_PRIVATE_KEY_A: JsonWebKey = {
  ...DPOP_TEST_PUBLIC_KEY_A,
  d: 'F6vmQ7oezQEch9yIHQP0frOd4cs1aX3TprV7EwMrDSI',
};

export const DPOP_TEST_PUBLIC_KEY_B: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'R4RrbVyqiOoPuy3sohE1KuM4vpupkJoeAx_pWbo4Zpo',
  y: 'J_1JtU1Z_Gaf5yk8F0aEDl9AEXxWaJ3XNIXOYkxwn1M',
};

const DPOP_TEST_PRIVATE_KEY_B: JsonWebKey = {
  ...DPOP_TEST_PUBLIC_KEY_B,
  d: 'K77m_Ngz9LVWj3Q1ksh5G6KN5NPWzrRIdovFO-gUATo',
};

const PRIVATE_KEY_A = createPrivateKey({
  key: DPOP_TEST_PRIVATE_KEY_A,
  format: 'jwk',
});
const PRIVATE_KEY_B = createPrivateKey({
  key: DPOP_TEST_PRIVATE_KEY_B,
  format: 'jwk',
});

const DPOP_TEST_IAT = 4070952000;
const DPOP_TEST_NONCE_VALUE =
  '67849200.D39EiUXtZzXo9pMNtusjSjClHXRY81m6xmkomp9li74';
const DPOP_TEST_ADDRESS_VALUE = 'https://api.example.test/api/oauth/token';

export interface DpopTestProofOptions {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  publicJwk?: JsonWebKey;
  signingKey?: 'A' | 'B';
  headerJson?: string;
  payloadJson?: string;
  signatureBytes?: Buffer;
  signatureLength?: number;
  token?: string;
}

export function signNativeDpopProof(
  options: DpopTestProofOptions = {},
): string {
  const headerJson =
    options.headerJson ??
    JSON.stringify({
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: options.publicJwk ?? DPOP_TEST_PUBLIC_KEY_A,
      ...options.header,
    });
  const payloadJson =
    options.payloadJson ??
    JSON.stringify({
      htm: 'POST',
      htu: DPOP_TEST_ADDRESS_VALUE,
      iat: DPOP_TEST_IAT,
      jti: 'dpop-test-proof-id',
      nonce: DPOP_TEST_NONCE_VALUE,
      ...(options.token
        ? {
            ath: createHash('sha256').update(options.token).digest('base64url'),
          }
        : {}),
      ...options.claims,
    });
  const header = Buffer.from(headerJson).toString('base64url');
  const payload = Buffer.from(payloadJson).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const key = options.signingKey === 'B' ? PRIVATE_KEY_B : PRIVATE_KEY_A;
  const signature =
    options.signatureBytes ??
    sign('sha256', Buffer.from(signingInput), {
      key,
      dsaEncoding: 'ieee-p1363',
    });
  const sizedSignature =
    options.signatureLength === undefined
      ? signature
      : resizedSignature(signature, options.signatureLength);

  return `${signingInput}.${sizedSignature.toString('base64url')}`;
}

function resizedSignature(signature: Buffer, length: number): Buffer {
  if (length <= signature.length) {
    return signature.subarray(0, length);
  }
  return Buffer.concat([signature, Buffer.alloc(length - signature.length)]);
}

export const DPOP_TEST_NONCE = DPOP_TEST_NONCE_VALUE;
export const DPOP_TEST_ADDRESS = DPOP_TEST_ADDRESS_VALUE;
