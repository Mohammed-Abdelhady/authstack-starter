// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { rolesApi } from '@/modules/roles/api/rolesApi';
import { requireObservedVersion } from '@/modules/auth/utils/observedVersion';
import { IDEMPOTENCY_HEADER } from '@/modules/auth/constants/staff-operation';
import {
  makeStore,
  registerFormTestLifecycle,
  stubNetwork,
  success,
} from '@/tests/serverRejectionHarness';

registerFormTestLifecycle();
const ROLE = {
  id: 'support',
  name: 'Support',
  slug: 'support',
  permissions: [],
  isProtected: false,
  isSystemRole: false,
  level: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

it('passes an observed zero role version into update then the returned version into DELETE query', async () => {
  const writes: Array<{ path: string; method: string; body?: unknown; version?: string | null }> =
    [];
  stubNetwork(async (request) => {
    if (request.method === 'GET') return success({ ...ROLE, version: 0 });
    if (request.method === 'DELETE') {
      writes.push({
        path: new URL(request.url).pathname,
        method: request.method,
        version: new URL(request.url).searchParams.get('version'),
      });
      return new Response(null, { status: 204 });
    }
    writes.push({
      path: new URL(request.url).pathname,
      method: request.method,
      body: await request.clone().json(),
    });
    return success({ ...ROLE, version: 9 });
  });
  const store = makeStore();
  const reading = store.dispatch(rolesApi.endpoints.getRole.initiate('support'));
  try {
    const observed = await reading.unwrap();
    const updated = await store
      .dispatch(
        rolesApi.endpoints.updateRole.initiate({
          idOrSlug: observed.id,
          data: { description: 'changed', version: requireObservedVersion(observed.version) },
        }),
      )
      .unwrap();
    const removed = await store
      .dispatch(
        rolesApi.endpoints.deleteRole.initiate({
          idOrSlug: updated.id,
          version: requireObservedVersion(updated.version),
        }),
      )
      .unwrap();
    expect(removed).toBeNull();
    expect(writes).toEqual([
      { path: '/api/roles/support', method: 'PATCH', body: { description: 'changed', version: 0 } },
      { path: '/api/roles/support', method: 'DELETE', version: '9' },
    ]);
  } finally {
    reading.unsubscribe();
  }
});

it('keeps the supplied create operation key and body unchanged across an unknown-outcome retry', async () => {
  const writes: Array<{ path: string; key: string | null; body: unknown }> = [];
  stubNetwork(async (request) => {
    writes.push({
      path: new URL(request.url).pathname,
      key: request.headers.get(IDEMPOTENCY_HEADER),
      body: await request.clone().json(),
    });
    if (writes.length === 1) throw new TypeError('network');
    return success({ ...ROLE, version: 0 });
  });
  const store = makeStore();
  const input = {
    data: { name: 'Support', permissions: ['profile:read:own'] },
    idempotencyKey: 'same-logical-create',
  };
  await expect(
    store.dispatch(rolesApi.endpoints.createRole.initiate(input)).unwrap(),
  ).rejects.toBeDefined();
  await store.dispatch(rolesApi.endpoints.createRole.initiate(input)).unwrap();
  expect(writes).toEqual([
    {
      path: '/api/roles',
      key: 'same-logical-create',
      body: { name: 'Support', permissions: ['profile:read:own'] },
    },
    {
      path: '/api/roles',
      key: 'same-logical-create',
      body: { name: 'Support', permissions: ['profile:read:own'] },
    },
  ]);
});
