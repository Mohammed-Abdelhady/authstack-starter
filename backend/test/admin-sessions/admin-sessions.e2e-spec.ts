import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ErrorCode } from '../../src/common/enums/error-code.enum';
import {
  SEED_ADMIN,
  SEED_MANAGER,
  SEED_SUPPORT,
  SEED_USER,
  type SeedUser,
} from '../constants/seed-users';
import type { ApiBody } from '../types/e2e-responses';
import {
  bootE2eApp,
  browserAgent,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import { TEST_NOW } from '../utils/frozen-clock';
import {
  createNativeApplication,
  issueNativeGrantFor,
} from '../utils/native/native-authorize.fixtures';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface SessionRow {
  id: string;
  clientId: string;
  credentialPurpose: string;
}
interface SessionPage {
  sessions: SessionRow[];
  total: number;
}
interface ErrorBody {
  error: { code: string };
}

describe('staff session routes', () => {
  let e2e: E2eApp;
  let admin: TestAgent;
  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);
  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);
  beforeEach(async () => {
    e2e.clock.set(TEST_NOW);
    e2e.app.get(ConfigService).set('auth.nativeEnabled', false);
    await e2e.reset();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
  });

  async function idOf(seed: SeedUser): Promise<string> {
    const id = await e2e.state.accounts.accountIdFor(seed.email);
    if (!id) throw new Error('seed account is missing');
    return id;
  }
  const route = (id: string) => `/api/admin/users/${id}/sessions`;

  it('lists live customer sessions with the application and credential kind and exposes no secrets', async () => {
    const user = await loginAs(e2e.httpServer, SEED_USER);
    const support = await loginAs(e2e.httpServer, SEED_SUPPORT);
    e2e.app.get(ConfigService).set('auth.nativeEnabled', true);
    await createNativeApplication(e2e);
    const native = await issueNativeGrantFor(e2e, SEED_USER.email);
    await request(e2e.httpServer)
      .get('/api/user/profile')
      .set('Authorization', `Bearer ${native.accessToken}`)
      .expect(200);
    const id = await idOf(SEED_USER);
    const response = await support.get(route(id)).expect(200);
    const data = (response.body as ApiBody<SessionPage>).data;
    expect(data.total).toBe(2);
    expect(
      data.sessions
        .map(({ clientId, credentialPurpose }) => ({
          clientId,
          credentialPurpose,
        }))
        .sort((first, second) => first.clientId.localeCompare(second.clientId)),
    ).toEqual([
      { clientId: 'native-app', credentialPurpose: 'native_access' },
      { clientId: 'web', credentialPurpose: 'browser_session' },
    ]);
    const allowedFields = [
      'clientId',
      'createdAt',
      'credentialPurpose',
      'deviceName',
      'deviceParts',
      'id',
      'ip',
      'isCurrent',
      'lastUsedAt',
      'userAgent',
    ];
    expect(
      data.sessions.flatMap((session) =>
        Object.keys(session).filter((key) => !allowedFields.includes(key)),
      ),
    ).toEqual([]);
    await user.get('/api/user/profile').expect(200);
  });

  it('refuses anonymous callers, missing permissions, self in any casing, peers, higher targets and wildcard peers', async () => {
    const userId = await idOf(SEED_USER);
    const supportId = await idOf(SEED_SUPPORT);
    const managerId = await idOf(SEED_MANAGER);
    const adminId = await idOf(SEED_ADMIN);
    const anonymous = await browserAgent(e2e.httpServer);
    await anonymous.get(route(userId)).expect(401);
    const user = await loginAs(e2e.httpServer, SEED_USER);
    await user.get(route(supportId)).expect(403);
    await user
      .post(`${route(supportId)}/revoke-all`)
      .send({})
      .expect(403);
    await user.delete(`${route(supportId)}/${adminId}`).expect(403);
    const support = await loginAs(e2e.httpServer, SEED_SUPPORT);
    const peer = await e2e.state.accounts.createAccount({
      email: 'peer@staff.local',
      name: 'Peer',
      role: 'support',
      isVerified: true,
    });
    for (const id of [peer._id, managerId]) {
      const refused = await support.get(route(id)).expect(404);
      expect((refused.body as ErrorBody).error.code).toBe(
        ErrorCode.USER_NOT_FOUND,
      );
    }
    await e2e.state.records.replaceAccountPermissions(supportId, ['*']);
    const wildcardPeer = await support.get(route(peer._id)).expect(403);
    expect((wildcardPeer.body as ErrorBody).error.code).toBe(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    );
    await support.get(route(managerId)).expect(403);
    for (const id of [adminId, adminId.toUpperCase()]) {
      const self = await admin.get(route(id)).expect(400);
      expect((self.body as ErrorBody).error.code).toBe(
        ErrorCode.CANNOT_MODIFY_SELF,
      );
      await admin
        .post(`${route(id)}/revoke-all`)
        .send({})
        .expect(400);
    }
    const otherAdmin = await e2e.state.accounts.createAccount({
      email: 'peer-admin@staff.local',
      name: 'Peer',
      role: 'admin',
      isVerified: true,
    });
    const refused = await admin
      .post(`${route(otherAdmin._id)}/revoke-all`)
      .send({})
      .expect(403);
    expect((refused.body as ErrorBody).error.code).toBe(
      ErrorCode.CANNOT_MODIFY_HIGHER_ROLE,
    );
  });

  it('makes a foreign session indistinguishable from an unknown id and preserves its credential', async () => {
    const targetId = await idOf(SEED_USER);
    const foreign = await loginAs(e2e.httpServer, SEED_SUPPORT);
    const own = await foreign.get('/api/user/sessions').expect(200);
    const foreignSessionId = (own.body as ApiBody<SessionPage>).data.sessions[0]
      ?.id;
    if (!foreignSessionId) throw new Error('foreign session was not listed');
    const absentId = await idOf(SEED_ADMIN);
    const wrong = await admin
      .delete(`${route(targetId)}/${foreignSessionId}`)
      .expect(404);
    const unknown = await admin
      .delete(`${route(targetId)}/${absentId}`)
      .expect(404);
    expect((wrong.body as ErrorBody).error).toEqual(
      (unknown.body as ErrorBody).error,
    );
    expect((wrong.body as ErrorBody).error.code).toBe(
      ErrorCode.SESSION_NOT_FOUND,
    );
    await foreign.get('/api/user/profile').expect(200);
  });

  it('requires separate staff read and delete scopes for a lower staff role', async () => {
    const targetId = await idOf(SEED_SUPPORT);
    await loginAs(e2e.httpServer, SEED_SUPPORT);
    const actorId = await idOf(SEED_MANAGER);
    await e2e.state.records.replaceAccountPermissions(actorId, [
      'sessions:delete:all',
    ]);
    const manager = await loginAs(e2e.httpServer, SEED_MANAGER);
    await manager.get(route(targetId)).expect(404);
    await manager
      .post(`${route(targetId)}/revoke-all`)
      .send({})
      .expect(404);
    await e2e.state.records.replaceAccountPermissions(actorId, [
      'sessions:delete:all',
      'sessions:read:staff',
      'sessions:delete:staff',
    ]);
    const listed = await manager.get(route(targetId)).expect(200);
    expect((listed.body as ApiBody<SessionPage>).data.total).toBe(1);
    const ended = await manager
      .post(`${route(targetId)}/revoke-all`)
      .send({})
      .expect(200);
    expect((ended.body as ApiBody<{ revokedCount: number }>).data).toEqual({
      revokedCount: 1,
    });
  });
});
