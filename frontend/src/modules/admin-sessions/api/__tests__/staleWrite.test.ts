import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_PERMISSIONS } from '@app/core';
import authReducer, { setUser } from '@/modules/auth/store/authSlice';
import { clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import { heldAnswer } from '@/tests/busyControls';
import { adminSessionsApi } from '../adminSessionsApi';
import { hasUnknownOutcome } from '../../utils/unknownOutcome';

const ACTOR = {
  id: 'staff-1',
  name: 'Staff',
  email: 'staff@example.test',
  role: 'staff',
  permissions: [SESSION_PERMISSIONS.READ_ALL, SESSION_PERMISSIONS.DELETE_ALL],
};

function makeStore() {
  const store = configureStore({
    reducer: { api: adminSessionsApi.reducer, auth: authReducer },
    middleware: (defaults) => defaults().concat(adminSessionsApi.middleware),
  });
  store.dispatch(setUser(ACTOR));
  return store;
}

afterEach(() => {
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe.each(['one', 'all'] as const)('late staff session %s write', (target) => {
  it('reports an accepted write as unknown after its scope became stale', async () => {
    const held = heldAnswer();
    const paths: string[] = [];
    vi.stubGlobal('fetch', (request: Request) => {
      paths.push(`${request.method} ${new URL(request.url).pathname}`);
      return held.answer;
    });
    rememberBrowserProof('proof', 'session');
    const store = makeStore();
    const scope = { actorId: 'staff-1', userId: 'user-2', sessionGeneration: 1 };
    const request =
      target === 'one'
        ? store.dispatch(
            adminSessionsApi.endpoints.endAdminSession.initiate({
              ...scope,
              sessionId: 'session-3',
            }),
          )
        : store.dispatch(adminSessionsApi.endpoints.endAllAdminSessions.initiate(scope));
    try {
      await vi.waitFor(() => expect(paths).toHaveLength(1));
      store.dispatch(setUser({ ...ACTOR, permissions: [] }));
      held.settle(() =>
        Response.json({
          success: true,
          data: target === 'one' ? { revoked: true } : { revokedCount: 1 },
        }),
      );
      const result = await request;
      expect(paths).toEqual([
        target === 'one'
          ? 'DELETE /api/admin/users/user-2/sessions/session-3'
          : 'POST /api/admin/users/user-2/sessions/revoke-all',
      ]);
      expect(result).toEqual({ error: { status: 'CUSTOM_ERROR', error: 'UNKNOWN_WRITE_OUTCOME' } });
      expect(hasUnknownOutcome(result.error)).toBe(true);
    } finally {
      request.abort();
      store.dispatch(adminSessionsApi.util.resetApiState());
    }
  });
});
