import type { Response } from 'supertest';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import {
  bootE2eApp,
  browserAgent,
  type E2eApp,
  type HttpServer,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const VICTIM_EMAIL = 'victim@example.test';
const REPEAT_VICTIM_EMAIL = 'repeat-victim@example.test';
const ATTACKER_PASSWORD = 'AttackerPass-1';
const VICTIM_PASSWORD = 'VictimPass-2';
const ATTACKER_NAME = 'Attacker Chosen';
const VICTIM_NAME = 'Victim Owner';
/** Three minutes, so four registrations stay inside the fifteen-minute window. */
const WINDOW_STEP_MS = 3 * 60 * 1000;

/**
 * A browser proof is spent by one unsafe request, so a real browser asks for a
 * fresh one before each POST. The same agent keeps the same cookie jar, which
 * is one of the two people in the scenario.
 */
async function postAs(
  client: TestAgent,
  path: string,
  body: Record<string, string>,
): Promise<Response> {
  const proof = await client.get('/api/auth/browser-proof').expect(200);
  const token = (proof.body as { data: { token: string } }).data.token;
  return client.post(path).set(CSRF_HEADER, token).send(body);
}

/** The sign-up values one person supplies, wherever the contract asks for them. */
interface SignUp {
  email: string;
  password: string;
  name: string;
}

/**
 * The two request shapes A3b moved: registration takes the address only, and
 * activation takes the password and name with the code.
 */
function registerAs(client: TestAgent, signUp: SignUp): Promise<Response> {
  return postAs(client, '/api/auth/register', {
    email: signUp.email,
  });
}

function activateAs(
  client: TestAgent,
  signUp: SignUp,
  code: string,
): Promise<Response> {
  return postAs(client, '/api/auth/activate', {
    email: signUp.email,
    code,
    password: signUp.password,
    name: signUp.name,
  });
}

/** What an attacker can still send: the old-shape body, and a wrong code. */
function oldShapeRegistration(
  client: TestAgent,
  signUp: SignUp,
): Promise<Response> {
  return postAs(client, '/api/auth/register', {
    email: signUp.email,
    password: signUp.password,
    name: signUp.name,
  });
}

async function signInWithPassword(
  server: HttpServer,
  email: string,
  password: string,
): Promise<Response> {
  const client = await browserAgent(server);
  return postAs(client, '/api/auth/login', { email, password });
}

/**
 * The plan's two halves in one assertion, so a red run shows both at once:
 * the owner's password works, and the first registrant's password does not.
 */
async function expectPasswordBoundToVictim(
  server: HttpServer,
  email: string,
): Promise<void> {
  const victim = await signInWithPassword(server, email, VICTIM_PASSWORD);
  const attacker = await signInWithPassword(server, email, ATTACKER_PASSWORD);

  expect({
    victimSignIn: victim.status,
    attackerSignIn: attacker.status,
  }).toEqual({ victimSignIn: 200, attackerSignIn: 401 });
}

describe('Registration takeover (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('binds the account to the caller who proves the address, not the first registrant', async () => {
    const attacker = await browserAgent(e2e.httpServer);
    const victim = await browserAgent(e2e.httpServer);
    const attackerSignUp: SignUp = {
      email: VICTIM_EMAIL,
      password: ATTACKER_PASSWORD,
      name: ATTACKER_NAME,
    };
    const victimSignUp: SignUp = {
      email: VICTIM_EMAIL,
      password: VICTIM_PASSWORD,
      name: VICTIM_NAME,
    };

    const oldShape = await oldShapeRegistration(attacker, attackerSignUp);
    expect(oldShape.status).toBe(400);

    const attackerRegister = await registerAs(attacker, attackerSignUp);
    expect(attackerRegister.status).toBe(200);

    const attackerWrongCode = await activateAs(
      attacker,
      attackerSignUp,
      '000000',
    );
    expect(attackerWrongCode.status).toBe(400);
    const attacked = await e2e.state.auth.pendingRegistrationFor(VICTIM_EMAIL);
    expect(attacked?.attempts).toBe(1);

    const victimRegister = await registerAs(victim, victimSignUp);
    expect(victimRegister.status).toBe(200);

    const code = await e2e.mailedCode();
    const activation = await activateAs(victim, victimSignUp, code);
    expect(activation.status).toBe(200);

    await expectPasswordBoundToVictim(e2e.httpServer, VICTIM_EMAIL);
  });

  it('still binds to the victim after the attacker re-registers three times inside the window', async () => {
    const attacker = await browserAgent(e2e.httpServer);
    const victim = await browserAgent(e2e.httpServer);
    const attackerSignUp: SignUp = {
      email: REPEAT_VICTIM_EMAIL,
      password: ATTACKER_PASSWORD,
      name: ATTACKER_NAME,
    };
    const victimSignUp: SignUp = {
      email: REPEAT_VICTIM_EMAIL,
      password: VICTIM_PASSWORD,
      name: VICTIM_NAME,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const attackerRegister = await registerAs(attacker, attackerSignUp);
      expect(attackerRegister.status).toBe(200);
      e2e.clock.advance(WINDOW_STEP_MS);
    }

    const attackerWrongCode = await activateAs(
      attacker,
      attackerSignUp,
      '000000',
    );
    expect(attackerWrongCode.status).toBe(400);

    const victimRegister = await registerAs(victim, victimSignUp);
    expect(victimRegister.status).toBe(200);

    const code = await e2e.mailedCode();
    const activation = await activateAs(victim, victimSignUp, code);
    expect(activation.status).toBe(200);

    await expectPasswordBoundToVictim(e2e.httpServer, REPEAT_VICTIM_EMAIL);
  });
});
