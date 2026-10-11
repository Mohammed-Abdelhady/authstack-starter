import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { ClockPort, CryptoPort, DeviceKeyPort } from '../../src';
import { buildDpopProof } from '../../src/proof/dpop-proof';
import { FakeTimer } from '../support/fake-timer';
import { FIXED_PUBLIC_JWK } from '../support/software-device-key';

/**
 * Builds the proof vectors the server's verifier is fed. Run it with
 * `UPDATE_DPOP_VECTOR=1 pnpm --filter @app/native-auth exec vitest run test/proof/dpop-vector.test.ts`
 * to write `dpop-vector.json` again. Only the signatures change between runs.
 */
export const VECTOR_FORMAT = 1;
export const VECTOR_PATH = 'test/proof/dpop-vector.json';

/** The instant, origin and nonce secret the server's own proof tests use. */
export const SERVER = {
  apiOrigin: 'https://api.example.test',
  nonceSecret: 'native-dpop-test-secret-at-least-32-chars',
  nowMs: 4_070_952_000_000,
} as const;

/** HMAC-SHA-256 of `native-dpop-nonce:67849200` under that secret, after its minute bucket. */
export const SERVER_NONCE = '67849200.D39EiUXtZzXo9pMNtusjSjClHXRY81m6xmkomp9li74';
export const JTI_BYTES_HEX = '000102030405060708090a0b0c0d0e0f';

export interface VectorRequest {
  name: string;
  method: string;
  path: string;
  /** The token the proof is bound to, or `null` for a code exchange. */
  token: string | null;
}

export const REQUESTS: readonly VectorRequest[] = [
  { name: 'code exchange', method: 'POST', path: '/api/oauth/token', token: null },
  { name: 'bound refresh', method: 'POST', path: '/api/oauth/token', token: 'refresh-secret-0' },
  { name: 'bound revoke', method: 'POST', path: '/api/oauth/revoke', token: 'refresh-secret-0' },
];

export interface ProofVector extends VectorRequest {
  nonce: string;
  jtiBytesHex: string;
  /** The decoded header and payload, exactly as signed. */
  header: string;
  payload: string;
  proof: string;
}

export interface VectorFile {
  format: number;
  about: string;
  key: { publicJwk: typeof FIXED_PUBLIC_JWK; thumbprint: string };
  server: typeof SERVER;
  vectors: ProofVector[];
}

const decode = (part: string | undefined): string =>
  Buffer.from(part ?? '', 'base64url').toString('utf8');

function fixedPorts(deviceKey: DeviceKeyPort) {
  const clock: ClockPort = { wallTime: () => SERVER.nowMs, monotonicTime: () => 0 };
  const crypto: CryptoPort = {
    randomBytes: async (length) => Uint8Array.from({ length }, (_value, index) => index),
    sha256: async (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest()),
  };
  return { deviceKey, clock, crypto, timer: new FakeTimer() };
}

/** One proof from the engine's own builder, for the fixed clock, proof id and nonce. */
export async function buildVector(
  request: VectorRequest,
  deviceKey: DeviceKeyPort,
): Promise<{ vector: ProofVector; thumbprint: string }> {
  const { proof, thumbprint } = await buildDpopProof({
    ...fixedPorts(deviceKey),
    serverBaseAddress: SERVER.apiOrigin,
    method: request.method,
    path: request.path,
    nonce: SERVER_NONCE,
    ...(request.token === null ? {} : { token: request.token }),
  });
  const [header, payload] = proof.split('.');
  return {
    thumbprint,
    vector: {
      ...request,
      nonce: SERVER_NONCE,
      jtiBytesHex: JTI_BYTES_HEX,
      header: decode(header),
      payload: decode(payload),
      proof,
    },
  };
}

export async function buildVectorFile(deviceKey: DeviceKeyPort): Promise<VectorFile> {
  const built = await Promise.all(REQUESTS.map((request) => buildVector(request, deviceKey)));
  return {
    format: VECTOR_FORMAT,
    about:
      'DPoP proofs built by the mobile sign-in engine for a fixed key, clock, proof id and nonce. The server verifier must accept each one at server.nowMs.',
    key: { publicJwk: FIXED_PUBLIC_JWK, thumbprint: built[0]?.thumbprint ?? '' },
    server: SERVER,
    vectors: built.map(({ vector }) => vector),
  };
}

export const serialize = (file: VectorFile): string => `${JSON.stringify(file, null, 2)}\n`;
