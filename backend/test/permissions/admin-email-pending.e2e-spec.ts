import * as bcrypt from 'bcrypt';
import type { Response } from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import {
  EMAIL_CHANGE_EMAIL_SUBJECT,
  EMAIL_CHANGE_NOTICE_SUBJECT,
  PASSWORD_RESET_EMAIL_SUBJECT, // feature:email-password
} from '../../src/mail/constants/mail.constants';
import { CSRF_HEADER } from '../../src/session/constants/browser-proof'; // feature:email-password
import { UserRole } from '../../src/user/enums/user-role.enum';
import { SEED_ADMIN, SEED_MANAGER } from '../constants/seed-users';
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

interface ErrorBody {
  error: { code: string };
}

interface AdminUserBody extends UserResponse {
  pendingEmail?: string;
}

const OLD = 'holder@example.test';
const NEW = 'stranger@example.test';
const TARGET = { email: OLD, password: 'Holder123!Aa' };
const CODE_LIFETIME_MS = 900_000;

describe('Admin address change waits for confirmation (e2e)', () => {
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
      password: await bcrypt.hash(TARGET.password, 4),
    }));
  });

  function move(agent: TestAgent, id: string, email: string) {
    return agent.patch(`/api/admin/users/${id}`).send({ email });
  }

  async function confirm(email: string, code: string): Promise<Response> {
    const agent = await browserAgent(e2e.httpServer);
    return agent.post('/api/auth/confirm-email-change').send({ email, code });
  }

  async function stored() {
    const account = await e2e.state.accounts.accountWithId(targetId);
    return {
      email: account?.email,
      generation: account?.addressGeneration,
      verified: account?.isVerified,
    };
  }

  async function mailTo(address: string) {
    return (await e2e.captureMail()).filter((mail) => mail.to === address);
  }

  function codeOf(response: { body: unknown }): string {
    return (response.body as ErrorBody).error.code;
  }

  async function idOf(email: string): Promise<string> {
    const id = await e2e.state.accounts.accountIdFor(email);
    if (!id) throw new Error(`no account at ${email}`);
    return id;
  }

  it('keeps the account on its address and reports the one it waits for', async () => {
    const moved = await move(admin, targetId, NEW).expect(200);

    const body = (moved.body as ApiBody<AdminUserBody>).data;
    expect([body.email, body.pendingEmail, body.isVerified]).toEqual([
      OLD,
      NEW,
      true,
    ]);
    expect(await stored()).toEqual({
      email: OLD,
      generation: 1,
      verified: true,
    });
    const read = await admin.get(`/api/admin/users/${targetId}`).expect(200);
    expect((read.body as ApiBody<AdminUserBody>).data.pendingEmail).toBe(NEW);
    const mailed = await mailTo(NEW);
    expect(mailed.map((mail) => mail.subject)).toEqual([
      EMAIL_CHANGE_EMAIL_SUBJECT,
    ]);
    expect((await mailTo(OLD)).map((mail) => mail.subject)).toEqual([
      EMAIL_CHANGE_NOTICE_SUBJECT,
    ]);
  });

  it('lists the waiting address on the account that waits and on no other', async () => {
    await move(admin, targetId, NEW).expect(200);

    const listed = await admin.get('/api/admin/users?limit=100').expect(200);

    const rows = (listed.body as ApiBody<{ data: AdminUserBody[] }>).data.data;
    expect(
      rows
        .filter((row) => row.pendingEmail !== undefined)
        .map((row) => [row.id, row.email, row.pendingEmail]),
    ).toEqual([[targetId, OLD, NEW]]);
  });

  it('reports no waiting address for an account nobody asked to move', async () => {
    const read = await admin.get(`/api/admin/users/${targetId}`).expect(200);

    expect((read.body as ApiBody<AdminUserBody>).data).not.toHaveProperty(
      'pendingEmail',
    );
  });

  // feature:email-password:start
  async function signIn(email: string, password: string): Promise<Response> {
    const agent = await browserAgent(e2e.httpServer);
    const proof = await agent.get('/api/auth/browser-proof').expect(200);
    return agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, (proof.body as { data: { token: string } }).data.token)
      .send({ email, password });
  }

  async function forgot(email: string): Promise<void> {
    const agent = await browserAgent(e2e.httpServer);
    await agent.post('/api/auth/forgot-password').send({ email }).expect(200);
  }

  it('gives the waiting address no sign-in and no password reset', async () => {
    await move(admin, targetId, NEW).expect(200);

    await forgot(NEW);
    const atNew = await signIn(NEW, TARGET.password);

    // The only mail the waiting address ever got is the confirmation code.
    expect((await mailTo(NEW)).map((mail) => mail.subject)).toEqual([
      EMAIL_CHANGE_EMAIL_SUBJECT,
    ]);
    expect(atNew.status).toBe(401);
    expect(await stored()).toEqual({
      email: OLD,
      generation: 1,
      verified: true,
    });
  });

  it('leaves sign-in and password reset with the address the account has', async () => {
    await move(admin, targetId, NEW).expect(200);

    await forgot(OLD);
    const atOld = await signIn(OLD, TARGET.password);

    expect(
      (await mailTo(OLD)).filter(
        (mail) => mail.subject === PASSWORD_RESET_EMAIL_SUBJECT,
      ),
    ).toHaveLength(1);
    expect(atOld.status).toBe(200);
  });

  it('moves sign-in to the new address once it is confirmed', async () => {
    await move(admin, targetId, NEW).expect(200);
    await confirm(NEW, await e2e.mailedCode()).then((response) =>
      expect(response.status).toBe(200),
    );

    expect((await signIn(NEW, TARGET.password)).status).toBe(200);
    expect((await signIn(OLD, TARGET.password)).status).toBe(401);
  });
  // feature:email-password:end

  it('moves the address and ends the sessions on the right code', async () => {
    const holder = await loginAs(e2e.httpServer, TARGET);
    await move(admin, targetId, NEW).expect(200);
    await holder.get('/api/user/profile').expect(200);

    const confirmed = await confirm(NEW, await e2e.mailedCode());

    expect(confirmed.status).toBe(200);
    expect(await stored()).toEqual({
      email: NEW,
      generation: 1,
      verified: true,
    });
    await holder.get('/api/user/profile').expect(401);
    const read = await admin.get(`/api/admin/users/${targetId}`).expect(200);
    expect((read.body as ApiBody<AdminUserBody>).data).not.toHaveProperty(
      'pendingEmail',
    );
  });

  it('changes nothing on a wrong code or after the code expired', async () => {
    const holder = await loginAs(e2e.httpServer, TARGET);
    await move(admin, targetId, NEW).expect(200);
    const code = await e2e.mailedCode();
    const wrongCode = code === '000000' ? '000001' : '000000';

    const wrong = await confirm(NEW, wrongCode);
    await holder.get('/api/user/profile').expect(200);
    e2e.clock.advance(CODE_LIFETIME_MS + 1);
    const expired = await confirm(NEW, code);

    expect([wrong.status, expired.status]).toEqual([400, 400]);
    expect([codeOf(wrong), codeOf(expired)]).toEqual([
      ErrorCode.ACTIVATION_CODE_INVALID,
      ErrorCode.ACTIVATION_CODE_INVALID,
    ]);
    expect(await stored()).toEqual({
      email: OLD,
      generation: 1,
      verified: true,
    });
  });

  it('refuses the code once another account took the address', async () => {
    await move(admin, targetId, NEW).expect(200);
    const code = await e2e.mailedCode();
    await e2e.state.accounts.createAccount({
      email: NEW,
      name: 'Arrived First',
      isVerified: true,
    });

    const refused = await confirm(NEW, code);

    expect(refused.status).toBe(400);
    expect(codeOf(refused)).toBe(ErrorCode.ACTIVATION_CODE_INVALID);
    expect((await stored()).email).toBe(OLD);
  });

  it('mails the waiting address again on a resend, and only while one waits', async () => {
    const path = `/api/admin/users/${targetId}/resend-email-change`;
    await admin.post(path).send({}).expect(400);
    await move(admin, targetId, NEW).expect(200);
    const firstCode = await e2e.mailedCode();

    await admin.post(path).send({}).expect(200);

    expect(await mailTo(NEW)).toHaveLength(2);
    expect(
      (await mailTo(OLD)).filter(
        (mail) => mail.subject === EMAIL_CHANGE_NOTICE_SUBJECT,
      ),
    ).toHaveLength(1);
    const resent = await e2e.mailedCode();
    const outcome = await confirm(NEW, resent);
    expect(outcome.status).toBe(200);
    expect(resent === firstCode ? 'same' : 'fresh').toBe('fresh');
  });

  it('refuses an address change of the actor, a peer and a higher rank', async () => {
    const adminId = await idOf(SEED_ADMIN.email);
    const { _id: peerId } = await e2e.state.accounts.createAccount({
      email: 'second-admin@seed.local',
      name: 'Second Admin',
      role: UserRole.ADMIN,
      isVerified: true,
    });
    const manager = await loginAs(e2e.httpServer, SEED_MANAGER);

    const own = await move(admin, adminId, NEW).expect(400);
    const peer = await move(admin, peerId, NEW).expect(403);
    const higher = await move(manager, adminId, NEW).expect(403);
    const lower = await move(manager, targetId, NEW).expect(403);

    expect([codeOf(own), codeOf(peer), codeOf(higher), codeOf(lower)]).toEqual([
      ErrorCode.CANNOT_MODIFY_SELF,
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
      ErrorCode.EMAIL_CHANGE_NOT_ALLOWED,
    ]);
    expect(await mailTo(NEW)).toHaveLength(0);
    expect(await stored()).toEqual({
      email: OLD,
      generation: 0,
      verified: true,
    });
  });
});
