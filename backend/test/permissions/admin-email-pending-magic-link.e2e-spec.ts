import * as bcrypt from 'bcrypt';
import request, { type Response } from 'supertest';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { SEED_ADMIN } from '../constants/seed-users';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const OLD = 'holder@example.test';
const NEW = 'stranger@example.test';
const PASSWORD = 'Holder123!Aa';

describe('Admin pending email and magic link confirmation (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;
  let targetId: string;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    ({ _id: targetId } = await e2e.state.accounts.createAccount({
      email: OLD,
      name: 'Account Holder',
      role: UserRole.SUPPORT,
      isVerified: true,
      addressGeneration: 0,
      password: await bcrypt.hash(PASSWORD, 4),
    }));
    e2e.app.get(ConfigService).set('magicLink.enabled', true);
  });

  async function verifyMagicLink(
    agent: TestAgent,
    token: string | null,
    confirm = false,
  ): Promise<Response> {
    const proof = await agent.get('/api/auth/browser-proof').expect(200);
    return agent
      .post('/api/auth/magic-link/verify')
      .set(CSRF_HEADER, (proof.body as { data: { token: string } }).data.token)
      .send({ token, ...(confirm ? { confirm: true } : {}) });
  }

  // A magic link must not take the address held by an email-change code.
  it('refuses a confirmed magic link on a claimed address and preserves the pending change', async () => {
    await admin
      .patch(`/api/admin/users/${targetId}`)
      .send({ email: NEW })
      .expect(200);
    const code = await e2e.mailedCode();
    const mailedBefore = (await e2e.captureMail()).length;
    const requester = await browserAgent(e2e.httpServer);
    await requester
      .post('/api/auth/magic-link/request')
      .send({ email: NEW })
      .expect(200);
    const mailed = (await e2e.captureMail()).slice(mailedBefore);
    expect(mailed.map((mail) => mail.to)).toEqual([NEW]);
    const link = mailed[0]?.text?.match(/https?:\/\/[^\s]+/)?.[0];
    const token = link ? new URL(link).searchParams.get('token') : null;
    if (!token) throw new Error('the mailed link had no token');
    const agent = request.agent(e2e.httpServer);

    const first = await verifyMagicLink(agent, token);
    const repeated = await verifyMagicLink(agent, token);

    for (const response of [first, repeated]) {
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: {
          requiresTwoFactor: false,
          user: null,
          requiresConfirmation: true,
          email: 's***@example.test',
        },
      });
    }
    await agent.get('/api/user/profile').expect(401);
    expect(await e2e.state.accounts.accountIdFor(NEW)).toBeNull();
    const holder = await e2e.state.accounts.accountWithId(targetId);
    expect(holder).toMatchObject({
      email: OLD,
      isVerified: true,
      pendingEmail: NEW,
      addressGeneration: 1,
    });
    const waiting = await admin.get(`/api/admin/users/${targetId}`).expect(200);
    expect(waiting.body).toMatchObject({ data: { pendingEmail: NEW } });

    const refused = await verifyMagicLink(agent, token, true);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      success: false,
      error: { code: ErrorCode.MAGIC_LINK_INVALID },
    });
    await agent.get('/api/user/profile').expect(401);
    expect(await e2e.state.accounts.accountIdFor(NEW)).toBeNull();
    expect(await e2e.state.accounts.accountWithId(targetId)).toMatchObject({
      email: OLD,
      pendingEmail: NEW,
      addressGeneration: 1,
      isVerified: true,
    });

    const confirmation = await browserAgent(e2e.httpServer);
    await confirmation
      .post('/api/auth/confirm-email-change')
      .send({ email: NEW, code })
      .expect(200);
    expect(await e2e.state.accounts.accountIdFor(NEW)).toBe(targetId);
    const confirmed = await e2e.state.accounts.accountWithId(targetId);
    expect(confirmed).toMatchObject({
      email: NEW,
      isVerified: true,
      addressGeneration: 1,
    });
    expect(confirmed?.pendingEmail).toBeUndefined();
  });
});
