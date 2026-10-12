import { createHmac } from 'node:crypto';
import request, { type Response } from 'supertest';
import { CSRF_HEADER } from '../../../src/session/constants/browser-proof';
import type { SeedUser } from '../../constants/seed-users';
import type { HttpServer, TestAgent } from '../e2e-app';

/**
 * Turns two-step sign-in on over HTTP and answers a held sign-in, with codes
 * worked out here from RFC 6238 and RFC 4648, not by the server's library.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_MS = 30_000;
const DIGITS = 6;

/** A 32 byte key in base64, the shape TOTP_ENCRYPTION_KEY takes. */
const FIXTURE_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');

function base32Decode(text: string): Buffer {
  let bits = '';
  for (const character of text.replace(/=+$/, '').toUpperCase()) {
    const value = BASE32_ALPHABET.indexOf(character);
    if (value < 0) throw new Error('the secret is not base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The six digit code an authenticator app shows for this secret at `at`. */
export function totpCodeAt(secret: string, at: Date): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / STEP_MS)));
  const digest = createHmac('sha1', base32Decode(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Gives the server a key to keep secrets under, and returns what puts the
 * previous value back.
 */
export function applyTwoFactorEnv(): () => void {
  const previous = process.env.TOTP_ENCRYPTION_KEY;
  process.env.TOTP_ENCRYPTION_KEY = FIXTURE_TOTP_KEY;
  return (): void => {
    if (previous === undefined) {
      delete process.env.TOTP_ENCRYPTION_KEY;
      return;
    }
    process.env.TOTP_ENCRYPTION_KEY = previous;
  };
}

export interface Enrolment {
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

/**
 * Runs setup and confirm for the signed-in account. The confirming code is
 * the one for `at`, which spends that step.
 */
export async function enrolTwoFactor(
  agent: TestAgent,
  password: string,
  at: Date,
): Promise<Enrolment> {
  const setup = await agent
    .post('/api/auth/2fa/setup')
    .send({ password })
    .expect(200);
  const { secret, otpauthUrl } = (
    setup.body as { data: { secret: string; otpauthUrl: string } }
  ).data;
  const confirmed = await agent
    .post('/api/auth/2fa/confirm')
    .send({ code: totpCodeAt(secret, at) })
    .expect(200);
  const { recoveryCodes } = (
    confirmed.body as { data: { recoveryCodes: string[] } }
  ).data;
  return { secret, otpauthUrl, recoveryCodes };
}

async function browserProof(agent: TestAgent): Promise<string> {
  const proof = await agent.get('/api/auth/browser-proof').expect(200);
  return (proof.body as { data: { token: string } }).data.token;
}

export interface FirstStep {
  agent: TestAgent;
  response: Response;
}

/** The password step of a sign-in, on a browser of its own. */
export async function passwordFirstStep(
  httpServer: HttpServer,
  user: SeedUser,
): Promise<FirstStep> {
  const agent = request.agent(httpServer);
  // Read first: a request takes the browser's cookies when it is made.
  const proof = await browserProof(agent);
  const response = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, proof)
    .send({ email: user.email, password: user.password });
  return { agent, response };
}

/** Answers the sign-in this browser's challenge cookie holds. */
export async function answerSecondStep(
  agent: TestAgent,
  answer: Record<string, unknown>,
): Promise<Response> {
  const proof = await browserProof(agent);
  return agent
    .post('/api/auth/2fa/verify')
    .set(CSRF_HEADER, proof)
    .send(answer);
}
