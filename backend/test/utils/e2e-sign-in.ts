import { WEB_CLIENT_ID } from '../../src/session/constants/client-ids';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SessionCookieService } from '../../src/auth/services/sessions/session-cookie.service';
import { Sessions } from '../../src/auth/services/sessions/sessions';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import type { SeedUser } from '../constants/seed-users';
import type { HttpServer, TestAgent } from './e2e-app';
import type { E2eState } from './e2e-storage';

const FIXTURE_HOST = '127.0.0.1';
const FIXTURE_USER_AGENT = 'Fixture/1';

interface BootedFixture {
  app: INestApplication;
  state: E2eState;
}

type SignIn = (httpServer: HttpServer, user: SeedUser) => Promise<TestAgent>;

const booted = new WeakMap<HttpServer, BootedFixture>();

/** Called by the fixture once it serves, so a sign-in can reach its services. */
export function rememberFixture(
  httpServer: HttpServer,
  fixture: BootedFixture,
): void {
  booted.set(httpServer, fixture);
}

// feature:email-password:start
/** A session from the real password login route. */
async function passwordSignIn(
  httpServer: HttpServer,
  user: SeedUser,
): Promise<TestAgent> {
  const agent = request.agent(httpServer);
  const proof = await agent.get('/api/auth/browser-proof').expect(200);
  const preAuth = (proof.body as { data: { token: string } }).data.token;
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, preAuth)
    .send({ email: user.email, password: user.password })
    .expect(200);
  return bindBrowserProof(agent, headerToken(login));
}

function headerToken(response: { headers: Record<string, unknown> }): string {
  const value = response.headers[CSRF_HEADER];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('login did not return a browser proof');
  }
  return value;
}
// feature:email-password:end

/**
 * A session the application's own session service issued for a stored
 * account, with no sign-in route in between. For a case that needs someone
 * signed in and is not about how they got there.
 */
export async function issuedSession(
  httpServer: HttpServer,
  user: Pick<SeedUser, 'email'>,
): Promise<TestAgent> {
  const fixture = booted.get(httpServer);
  if (!fixture) throw new Error('no fixture serves on this server');
  const accountId = await fixture.state.accounts.accountIdFor(user.email);
  if (!accountId) throw new Error(`no account is stored for ${user.email}`);
  const issued = await fixture.app
    .get(Sessions, { strict: false })
    .createSession(accountId, FIXTURE_USER_AGENT, FIXTURE_HOST, WEB_CLIENT_ID);
  const cookieName = fixture.app.get(SessionCookieService, {
    strict: false,
  }).name;
  const agent = request.agent(httpServer);
  agent.jar.setCookie(
    `${cookieName}=${issued.sessionToken}; Path=/; HttpOnly`,
    FIXTURE_HOST,
    '/',
  );
  return bindBrowserProof(agent, issued.csrfToken);
}

/** The first of these the project carries is how a case gets a session. */
const SIGN_IN_WAYS: SignIn[] = [
  passwordSignIn, // feature:email-password
  issuedSession,
];

/** Returns an agent signed in as a seed user. */
export const loginAs: SignIn = (httpServer, user) =>
  SIGN_IN_WAYS[0](httpServer, user);

export async function browserAgent(httpServer: HttpServer): Promise<TestAgent> {
  const agent = request.agent(httpServer);
  const proof = await agent.get('/api/auth/browser-proof').expect(200);
  const token = (proof.body as { data: { token: string } }).data.token;
  return bindBrowserProof(agent, token);
}

function bindBrowserProof(agent: TestAgent, token: string): TestAgent {
  const methods = ['post', 'put', 'patch', 'delete'] as const;
  for (const method of methods) {
    const original = agent[method].bind(agent);
    agent[method] = (url: string) => original(url).set(CSRF_HEADER, token);
  }
  return agent;
}
