import request, { type Response } from 'supertest';
import { SEED_ADMIN, SEED_MANAGER, SEED_USER } from '../constants/seed-users';
import type { ApiBody } from '../types/e2e-responses';
import {
  bootE2eApp,
  loginAs,
  type E2eApp,
  type TestAgent,
} from '../utils/e2e-app';
import {
  ABSENT_ID,
  MALFORMED_ID_ANSWER,
  MALFORMED_IDS,
  refusal,
  refusalAnswer,
  type RefusalAnswer,
} from '../utils/route-id-answers';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

interface IdRoute {
  name: string;
  send: (caller: TestAgent, id: string, body?: object) => Promise<Response>;
  /** A body the route accepts, and one its validation refuses. */
  body?: object;
  refusedBody?: object;
  absent: RefusalAnswer;
  /** What a signed-in caller without the route's permission is told. */
  withoutPermission?: RefusalAnswer;
}

const USER_NOT_FOUND = refusal(404, 'USER_NOT_FOUND', 'User not found');
const NO_SESSION = refusal(401, 'SESSION_REQUIRED', 'Authentication required');
const lacking = (permission: string): RefusalAnswer =>
  refusal(403, 'FORBIDDEN', `Missing required permissions: ${permission}`);
const PERMISSION = encodeURIComponent('reports:read:all');

const ROUTES: IdRoute[] = [
  {
    name: 'GET /admin/users/:id',
    send: (caller, id) => caller.get(`/api/admin/users/${id}`),
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('users:read:all'),
  },
  {
    name: 'PATCH /admin/users/:id',
    send: (caller, id, body) =>
      caller.patch(`/api/admin/users/${id}`).send(body),
    body: { name: 'Renamed' },
    refusedBody: { name: 7 },
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('users:update:all'),
  },
  {
    name: 'POST /admin/users/:id/resend-email-change',
    send: (caller, id) =>
      caller.post(`/api/admin/users/${id}/resend-email-change`),
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('users:update:all'),
  },
  {
    name: 'PATCH /admin/users/:id/status',
    send: (caller, id, body) =>
      caller.patch(`/api/admin/users/${id}/status`).send(body),
    body: { isActive: false },
    refusedBody: { isActive: 'perhaps' },
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('users:update:all'),
  },
  {
    name: 'PATCH /admin/users/:id/role',
    send: (caller, id, body) =>
      caller.patch(`/api/admin/users/${id}/role`).send(body),
    body: { role: 'user' },
    refusedBody: { role: 7 },
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('users:update:all'),
  },
  {
    name: 'DELETE /admin/users/:id',
    send: (caller, id) => caller.delete(`/api/admin/users/${id}`),
    absent: refusal(
      400,
      'USER_ALREADY_DELETED',
      'User not found or already deleted',
    ),
    withoutPermission: lacking('users:delete:all'),
  },
  {
    name: 'GET /admin/users/:id/permissions',
    send: (caller, id) => caller.get(`/api/admin/users/${id}/permissions`),
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('permissions:read:all'),
  },
  {
    name: 'POST /admin/users/:id/permissions',
    send: (caller, id, body) =>
      caller.post(`/api/admin/users/${id}/permissions`).send(body),
    body: { permission: 'reports:read:all' },
    refusedBody: { permission: 'no-colons' },
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('permissions:grant:all'),
  },
  {
    name: 'DELETE /admin/users/:id/permissions/:permission',
    send: (caller, id) =>
      caller.delete(`/api/admin/users/${id}/permissions/${PERMISSION}`),
    absent: USER_NOT_FOUND,
    withoutPermission: lacking('permissions:revoke:all'),
  },
  {
    name: 'DELETE /user/sessions/:sessionId',
    send: (caller, id) => caller.delete(`/api/user/sessions/${id}`),
    absent: refusal(
      404,
      'SESSION_NOT_FOUND',
      'Session not found or already revoked',
    ),
  },
];

describe('answers to an id in the path (e2e)', () => {
  let e2e: E2eApp;
  let admin: TestAgent;
  let manager: TestAgent;
  let user: TestAgent;

  beforeAll(async () => {
    e2e = await bootE2eApp();
    admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    manager = await loginAs(e2e.httpServer, SEED_MANAGER);
    user = await loginAs(e2e.httpServer, SEED_USER);
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  describe.each(ROUTES)('$name', (route) => {
    it.each(MALFORMED_IDS)('refuses %s as an id', async (_, id) => {
      const response = await route.send(admin, id, route.body);

      expect(refusalAnswer(response)).toEqual(MALFORMED_ID_ANSWER);
    });

    it('answers for a well-formed id that names nothing', async () => {
      const response = await route.send(admin, ABSENT_ID, route.body);

      expect(refusalAnswer(response)).toEqual(route.absent);
    });

    it('tells a caller without a session nothing about the id', async () => {
      const anonymous = request(e2e.httpServer);

      const answers = [
        refusalAnswer(await route.send(anonymous, 'not-an-id', route.body)),
        refusalAnswer(await route.send(anonymous, ABSENT_ID, route.body)),
      ];

      expect(answers).toEqual([NO_SESSION, NO_SESSION]);
    });
  });

  const guarded = ROUTES.filter((route) => route.withoutPermission);
  it.each(guarded)(
    '$name tells a caller without the permission nothing about the id',
    async (route) => {
      const answers = [
        refusalAnswer(await route.send(user, 'not-an-id', route.body)),
        refusalAnswer(await route.send(user, ABSENT_ID, route.body)),
      ];

      expect(answers).toEqual([
        route.withoutPermission,
        route.withoutPermission,
      ]);
    },
  );

  const withBody = ROUTES.filter((route) => route.refusedBody);
  it.each(withBody)(
    '$name refuses the id before a body it would also refuse',
    async (route) => {
      const response = await route.send(admin, 'not-an-id', route.refusedBody);

      expect(refusalAnswer(response)).toEqual(MALFORMED_ID_ANSWER);
    },
  );

  it("answers not found for another account's session", async () => {
    const listed = await manager.get('/api/user/sessions').expect(200);
    const { sessions } = (
      listed.body as ApiBody<{ sessions: Array<{ id: string }> }>
    ).data;

    const response = await admin.delete(`/api/user/sessions/${sessions[0].id}`);
    const after = await manager.get('/api/user/sessions');

    expect(refusalAnswer(response)).toEqual(
      refusal(404, 'SESSION_NOT_FOUND', 'Session not found or already revoked'),
    );
    expect(after.status).toBe(200);
  });
});
