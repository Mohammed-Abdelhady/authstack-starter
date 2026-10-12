import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nativeDpopNonceCandidates } from '../../../src/session/native/proof/native-dpop-nonce';
import { verifyNativeDpopProof } from '../../../src/session/native/proof/native-dpop-proof';

interface EngineVector {
  name: string;
  method: string;
  path: string;
  token: string | null;
  header: string;
  payload: string;
  proof: string;
}

interface ProofFile {
  format: number;
  key: { thumbprint: string };
  server: { apiOrigin: string; nonceSecret: string; nowMs: number };
  vectors: EngineVector[];
}

const FILE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../shared/sdk/test/fixtures/native-dpop-vector.json',
    ),
    'utf8',
  ),
) as ProofFile;
const NOW = new Date(FILE.server.nowMs);
const EXPECTED_JTI = 'AAECAwQFBgcICQoLDA0ODw';

function verify(
  vector: EngineVector,
  change: {
    method?: string;
    address?: string;
    token?: string;
    now?: Date;
    proof?: string;
    nonceSecret?: string;
  } = {},
) {
  return verifyNativeDpopProof({
    proof: change.proof ?? vector.proof,
    expectedMethod: change.method ?? vector.method,
    expectedAddress: change.address ?? `${FILE.server.apiOrigin}${vector.path}`,
    now: change.now ?? NOW,
    expectedNonces: nativeDpopNonceCandidates(
      change.nonceSecret ?? FILE.server.nonceSecret,
      NOW,
    ),
    ...(change.token === undefined
      ? vector.token === null
        ? {}
        : { token: vector.token }
      : { token: change.token }),
  });
}

describe('mobile engine DPoP proof against the backend verifier', () => {
  it('reads the versioned engine vector for all three request kinds', () => {
    expect(FILE.format).toBe(1);
    expect(FILE.vectors.map((vector) => vector.name)).toEqual([
      'code exchange',
      'bound refresh',
      'bound revoke',
    ]);
    expect(FILE.server.nowMs).toBe(4070952000000);
  });

  it.each(FILE.vectors)(
    'accepts $name exactly as the engine signs it',
    (vector) => {
      const [header, payload] = vector.proof.split('.');
      expect(Buffer.from(header, 'base64url').toString('utf8')).toBe(
        vector.header,
      );
      expect(Buffer.from(payload, 'base64url').toString('utf8')).toBe(
        vector.payload,
      );
      expect(verify(vector)).toEqual({
        ok: true,
        thumbprint: FILE.key.thumbprint,
        jti: EXPECTED_JTI,
      });
    },
  );

  it.each(FILE.vectors)(
    'rejects changed request fields for $name',
    (vector) => {
      expect(verify(vector, { method: 'GET' })).toEqual({
        ok: false,
        reason: 'NATIVE_DPOP_PROOF_METHOD_MISMATCH',
      });
      expect(
        verify(vector, { address: `${FILE.server.apiOrigin}/api/other` }),
      ).toEqual({
        ok: false,
        reason: 'NATIVE_DPOP_PROOF_ADDRESS_MISMATCH',
      });
      expect(
        verify(vector, { address: `https://other.example.test${vector.path}` }),
      ).toEqual({
        ok: false,
        reason: 'NATIVE_DPOP_PROOF_ADDRESS_MISMATCH',
      });
      expect(
        verify(vector, {
          nonceSecret: 'another-dpop-secret-at-least-32-chars',
        }),
      ).toEqual({ ok: false, reason: 'NATIVE_DPOP_NONCE_INVALID' });
      expect(
        verify(vector, { now: new Date(FILE.server.nowMs + 61_000) }),
      ).toEqual({ ok: false, reason: 'NATIVE_DPOP_PROOF_IAT_INVALID' });
    },
  );

  it.each(FILE.vectors.filter((vector) => vector.token !== null))(
    'rejects another token for $name',
    (vector) => {
      expect(verify(vector, { token: 'another-token' })).toEqual({
        ok: false,
        reason: 'NATIVE_DPOP_PROOF_ATH_INVALID',
      });
    },
  );

  it('rejects a token attached to the unbound exchange', () => {
    expect(verify(FILE.vectors[0], { token: 'unexpected-token' })).toEqual({
      ok: false,
      reason: 'NATIVE_DPOP_PROOF_ATH_INVALID',
    });
  });

  it('rejects a signed proof after one bit changes', () => {
    const vector = FILE.vectors[1];
    const [header, payload, signature] = vector.proof.split('.');
    const bytes = Buffer.from(signature, 'base64url');
    bytes[0] ^= 1;
    expect(
      verify(vector, {
        proof: `${header}.${payload}.${bytes.toString('base64url')}`,
      }),
    ).toEqual({ ok: false, reason: 'NATIVE_DPOP_PROOF_SIGNATURE_INVALID' });
  });
});
