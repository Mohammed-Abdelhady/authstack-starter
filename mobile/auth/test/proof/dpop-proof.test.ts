import { ACCESS_TOKEN } from '../support/support';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { ClockPort, CryptoPort, TimerPort } from '../../src';
import { buildDpopProof } from '../../src/proof/dpop-proof';
import { FakeTimer } from '../support/fake-timer';
import { FIXED_PUBLIC_JWK, SoftwareDeviceKey } from '../support/software-device-key';

const EXPECTED_HEADER =
  '{"typ":"dpop+jwt","alg":"ES256","jwk":{"kty":"EC","crv":"P-256","x":"kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394","y":"Dhwd2dUIhY_-YTgJDQNh7VMP7CMF7LhiwZAwaFo17BM","alg":"ES256"}}';
const EXPECTED_PAYLOAD =
  '{"htm":"POST","htu":"https://api.example.test/api/oauth/token","iat":1800000000,"jti":"AAECAwQFBgcICQoLDA0ODw","nonce":"nonce-fixed","ath":"F-8c8RaqqgIi9FlnI4Jq9ASjhz4QE7nmhw2cCXIl41s"}';

function proofPorts(deviceKey: SoftwareDeviceKey, timer = new FakeTimer()) {
  const clock: ClockPort = {
    wallTime: () => 1_800_000_000_000,
    monotonicTime: () => 1_000,
  };
  const crypto: CryptoPort = {
    randomBytes: async (length) =>
      length === 16
        ? Uint8Array.from({ length: 16 }, (_value, index) => index)
        : new Uint8Array(length),
    sha256: async (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest()),
  };
  const timerPort: TimerPort = timer;
  return { deviceKey, clock, crypto, timer: timerPort, timerState: timer };
}

describe('DPoP proof builder', () => {
  it('builds the fixed request vector and a server-verifiable P-256 signature', async () => {
    const deviceKey = new SoftwareDeviceKey();
    const ports = proofPorts(deviceKey);
    const result = await buildDpopProof({
      ...ports,
      serverBaseAddress: 'https://api.example.test',
      method: 'POST',
      path: '/api/oauth/token?discard=this#fragment',
      token: ACCESS_TOKEN,
      nonce: 'nonce-fixed',
    });
    const [headerPart, payloadPart, signaturePart] = result.proof.split('.');
    const header = Buffer.from(headerPart ?? '', 'base64url').toString('utf8');
    const payload = Buffer.from(payloadPart ?? '', 'base64url').toString('utf8');
    const signingInput = Buffer.from(`${headerPart}.${payloadPart}`);
    const publicKey = createPublicKey({
      key: {
        kty: FIXED_PUBLIC_JWK.kty,
        crv: FIXED_PUBLIC_JWK.crv,
        x: FIXED_PUBLIC_JWK.x,
        y: FIXED_PUBLIC_JWK.y,
      },
      format: 'jwk',
    });

    expect(header).toBe(EXPECTED_HEADER);
    expect(payload).toBe(EXPECTED_PAYLOAD);
    expect(result.thumbprint).toBe('2Z-ICOWJ-osZEZ-v5VqCUGhisbZ2H1ilwlEG3R_VECU');
    expect(signaturePart).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      verify(
        'sha256',
        signingInput,
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signaturePart ?? '', 'base64url'),
      ),
    ).toBe(true);
    expect(ports.timerState.pending).toBe(0);
  });

  it('refuses a signature that is not the ES256 r||s width', async () => {
    const deviceKey = new SoftwareDeviceKey();
    deviceKey.signatureOverride = new Uint8Array(63);
    const ports = proofPorts(deviceKey);

    await expect(
      buildDpopProof({
        ...ports,
        serverBaseAddress: 'https://api.example.test',
        method: 'POST',
        path: '/api/oauth/token',
      }),
    ).rejects.toMatchObject({ name: 'DeviceKeyAuthError', reason: 'keyInvalidated' });
  });

  it('refuses random output that cannot form the configured JTI', async () => {
    const ports = proofPorts(new SoftwareDeviceKey());
    ports.crypto.randomBytes = async () => new Uint8Array(15);

    await expect(
      buildDpopProof({
        ...ports,
        serverBaseAddress: 'https://api.example.test',
        method: 'POST',
        path: '/api/oauth/token',
      }),
    ).rejects.toThrow('wrong DPoP id length');
    expect(ports.timerState.pending).toBe(0);
  });

  it('preserves typed key-port failures from signing', async () => {
    const deviceKey = new SoftwareDeviceKey();
    deviceKey.signResult = { kind: 'cancelled' };
    const ports = proofPorts(deviceKey);

    await expect(
      buildDpopProof({
        ...ports,
        serverBaseAddress: 'https://api.example.test',
        method: 'POST',
        path: '/api/oauth/token',
      }),
    ).rejects.toMatchObject({ name: 'DeviceKeyAuthError', reason: 'cancelled' });
  });
});
