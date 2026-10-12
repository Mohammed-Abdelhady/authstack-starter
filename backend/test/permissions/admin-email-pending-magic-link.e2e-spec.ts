import * as bcrypt from 'bcrypt';
import request, { type Response } from 'supertest';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import { UserRole } from '../../src/user/enums/user-role.enum';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof';
import { SEED_ADMIN } from '../constants/seed-users';
import type { ApiBody, UserResponse } from '../types/e2e-responses';
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

interface AdminUserBody extends UserResponse {
  pendingEmail?: string;
}

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
      .send({ token, ...(confirm ? { confirm: true } : {}) })
      .expect(200);
  }

  it('keeps another browser unspent until it confirms the pending address link', async () => {
    await admin
      .patch(`/api/admin/users/${targetId}`)
      .send({ email: NEW })
      .expect(200);
    const code = await e2e.mailedCode();
    const requester = await browserAgent(e2e.httpServer);
    await requester
      .post('/api/auth/magic-link/request')
      .send({ email: NEW })
      .expect(200);
    const link = (await e2e.captureMail())
      .at(-1)
      ?.text?.match(/https?:\/\/[^\s]+/)?.[0];
    const token = link ? new URL(link).searchParams.get('token') : null;
    const agent = request.agent(e2e.httpServer);

    const first = await verifyMagicLink(agent, token);
    const repeated = await verifyMagicLink(agent, token);

    for (const response of [first, repeated]) {
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
    expect((waiting.body as ApiBody<AdminUserBody>).data.pendingEmail).toBe(
      NEW,
    );

    const confirmed = await verifyMagicLink(agent, token, true);
    const profile = await agent.get('/api/user/profile').expect(200);
    const signedIn = (profile.body as ApiBody<UserResponse>).data;
    expect(signedIn.id).not.toBe(targetId);
    expect(signedIn.role).toBe(UserRole.USER);
    expect(confirmed.body).toMatchObject({
      data: { user: { id: signedIn.id, email: NEW } },
    });

    const confirmation = await browserAgent(e2e.httpServer);
    const changeConfirmation = await confirmation
      .post('/api/auth/confirm-email-change')
      .send({ email: NEW, code })
      .expect(400);
    expect(changeConfirmation.body.error.code).toBe(
      ErrorCode.ACTIVATION_CODE_INVALID,
    );
    expect(await e2e.state.accounts.accountWithId(targetId)).toMatchObject({
      email: OLD,
      isVerified: true,
      pendingEmail: NEW,
      addressGeneration: 1,
    });
  });
});
