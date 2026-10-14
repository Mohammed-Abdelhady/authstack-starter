import { HTTP_METHOD } from '@app/sdk';
import { Buffer } from 'node:buffer';
import { createAuthEngine } from './engine';
import { SoftwareDeviceKey } from './software-device-key';
import {
  CONFIG,
  ScriptedTransport,
  acceptCode,
  successUserReply,
  testPorts,
  type TransportStep,
} from './support';
import { allowRefreshReplayAfterDpopNonce } from './tracking';

export const CHALLENGE_NONCE = 'server-nonce-0';

/** What the server answers to a proof whose nonce it does not accept. */
export function dpopChallenge(nonce = CHALLENGE_NONCE) {
  return { status: 400, body: { error: 'use_dpop_nonce' }, headers: { 'DPoP-Nonce': nonce } };
}

/**
 * The engine's first proof carries an empty nonce, so the server answers every
 * bound exchange, refresh and revoke with a challenge before anything else.
 */
export function challengeThen(...steps: TransportStep[]): TransportStep[] {
  return [dpopChallenge(), ...steps];
}

/** Scripts one bound refresh of `token`: the challenge, then what follows it. */
export function enqueueBoundRefresh(
  transport: ScriptedTransport,
  token: string,
  ...steps: TransportStep[]
): void {
  allowRefreshReplayAfterDpopNonce(token);
  transport.enqueue(...challengeThen(...steps));
}

export function proofNonces(
  requests: readonly { headers?: Readonly<Record<string, string>> | undefined }[],
) {
  return requests.map(({ headers }) => requestPayload(headers?.['DPoP'] ?? '').nonce);
}

interface DpopPayload {
  htm?: unknown;
  htu?: unknown;
  nonce?: unknown;
  jti?: unknown;
  ath?: unknown;
}

export function requestPayload(proof: string): DpopPayload {
  const payload = proof.split('.')[1] ?? '';
  const fields: DpopPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return fields;
}

export function dpopTokenReply(
  accessToken = 'access-secret-0',
  refreshToken = 'refresh-secret-0',
  expiresIn = 300,
) {
  return {
    status: 200,
    body: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: 'api',
    },
  };
}

export function refreshRequests(transport: ScriptedTransport) {
  return transport.sent.filter(({ path, body }) => {
    if (path !== '/api/oauth/token' || typeof body !== 'object' || body === null) return false;
    return 'grant_type' in body && body.grant_type === 'refresh_token';
  });
}

export async function establishBoundSession(transport = new ScriptedTransport()) {
  const deviceKey = new SoftwareDeviceKey();
  const ports = testPorts(transport, deviceKey);
  transport.enqueue(...challengeThen(dpopTokenReply()), successUserReply());
  acceptCode(ports.authBrowser, 'bound-code');
  const engine = createAuthEngine(CONFIG, ports);
  await engine.restore();
  const outcome = await engine.signIn();
  return { engine, ports, transport, deviceKey, outcome };
}

export async function requestProfile(engine: ReturnType<typeof createAuthEngine>) {
  return engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
}
