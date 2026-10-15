import request from 'supertest';
import { SecurityEventRecorder } from '../../src/session/events/security-event-recorder';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { bootE2eApp, loginAs, type E2eApp } from '../utils/e2e-app';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

const ACTIVITY_PATH = '/api/admin/activity';

describe('staff activity access and outage honesty (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2eApp();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    await e2e.reset();
  });

  afterAll(async () => {
    await e2e?.close();
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('b17 refuses an anonymous caller and a signed-in account without activity permission', async () => {
    await request(e2e.httpServer).get(ACTIVITY_PATH).expect(401);
    const user = await loginAs(e2e.httpServer, SEED_USER);
    await user.get(ACTIVITY_PATH).expect(403);
  });

  it('b17 gives an authorized reader an honest empty staff page', async () => {
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    const response = await admin.get(ACTIVITY_PATH).expect(200);
    const body: unknown = response.body;
    expect(body).toEqual({
      success: true,
      data: {
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
    });
  });

  it('publishes the activity DTO without persistence or repair metadata', async () => {
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    await e2e.app.get(SecurityEventRecorder).recordOutsideUnitOfWork({
      actorId: 'staff-fixture',
      targetUserId: 'target-fixture',
      clientId: 'admin',
      sessionId: 'session-fixture',
      requestId: 'private-request-id',
      action: 'sessions_revoked_all',
      roleAssignment: {
        assignedRoleId: 'new-role',
        previousRoleId: 'old-role',
        sessionVersion: 7,
      },
    });
    const response = await admin.get(ACTIVITY_PATH).expect(200);
    const body: unknown = response.body;
    expect(body).toEqual({
      success: true,
      data: {
        data: [
          {
            id: expect.any(String),
            occurredAt: expect.any(String),
            action: 'sessions_revoked_all',
            outcome: 'succeeded',
            actorId: 'staff-fixture',
            targetUserId: 'target-fixture',
            clientId: 'admin',
            sessionId: 'session-fixture',
            details: {},
            roleAssignment: {
              assignedRoleId: 'new-role',
              previousRoleId: 'old-role',
            },
          },
        ],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    });
  });

  it('b17 reports a real activity database read failure without returning an empty page', async () => {
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    await e2e.app.get(SecurityEventRecorder).recordOutsideUnitOfWork({
      actorId: 'staff-fixture',
      targetUserId: 'target-fixture',
      action: 'account_created',
    });
    const restore = await e2e.state.records.makeActivityUnreadable();
    try {
      const response = await admin.get(ACTIVITY_PATH).expect(500);
      const body: unknown = response.body;
      expect(body).toMatchObject({ success: false });
      expect(body).not.toHaveProperty('data');
    } finally {
      await restore();
    }
    const restored = await admin.get(ACTIVITY_PATH).expect(200);
    expect(restored.body).toMatchObject({
      success: true,
      data: { pagination: { total: 1 } },
    });
  });
});
