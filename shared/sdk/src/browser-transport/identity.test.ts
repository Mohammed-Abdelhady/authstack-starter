import { describe, expect, it } from 'vitest';
import { createBrowserTransport, StaleResponseError } from '../browser-transport';
import type { BrowserFetchResponse } from './types';
import { deferred, network, refusal, reply } from './test-support';

const PROFILE = {
  id: 'current',
  email: 'mona@example.com',
  name: 'Mona',
  role: 'support',
  permissions: ['profile:read:own'],
  authProvider: 'email',
  isVerified: true,
  twoFactorEnabled: false,
  passkeyCount: 0,
  linkedProviders: ['email'],
};

const OBSOLETE_REPLIES = [
  {
    name: 'signed-in',
    response: reply(
      { success: true, data: { authenticated: true, user: { ...PROFILE, id: 'old' } } },
      200,
      'old',
    ),
  },
  {
    name: 'signed-out',
    response: reply({ success: true, data: { authenticated: false, user: null } }),
  },
  {
    name: 'malformed with old proof',
    response: reply({ success: true, data: { authenticated: 'false', user: null } }, 200, 'old'),
  },
  { name: 'failed', response: refusal('SESSION_INVALID', 401) },
  { name: 'network failure', response: new Error('offline') },
  {
    name: 'invalid JSON with old proof',
    response: { status: 200, headers: { get: () => 'old' }, text: async () => '<html>old</html>' },
  },
];

describe('identity response fence', () => {
  // Mutation: browser-transport.ts, throw StaleResponseError without the received response.
  it('h3 retains the original late response status body and headers on the stale rejection', async () => {
    let generation = 1;
    const pending = deferred<BrowserFetchResponse>();
    const transport = createBrowserTransport({
      identityFence: { snapshot: () => generation, isCurrent: (value) => value === generation },
      fetch: async () => pending.promise,
    });
    const read = transport.request({ method: 'GET', path: '/api/auth/identity' });
    generation = 2;
    transport.rememberBrowserProof('current-session', 'session');
    pending.resolve(
      reply(
        {
          success: false,
          error: { code: 'SESSION_INVALID', message: 'expired' },
          requestId: 'old-request',
        },
        401,
        'old-proof',
      ),
    );
    await expect(read).rejects.toMatchObject({
      name: 'StaleResponseError',
      response: {
        status: 401,
        body: {
          success: false,
          error: { code: 'SESSION_INVALID', message: 'expired' },
          requestId: 'old-request',
        },
        headers: { 'x-csrf-token': 'old-proof' },
      },
    });
    expect(transport.currentBrowserProof()).toBe('current-session');
    expect(transport.csrfLookupHint()).toBe('unknown');
  });

  // Mutation: browser-transport.ts captureFence, treat every snapshot as current.
  it.each(OBSOLETE_REPLIES)(
    'h3 h14 rejects an obsolete $name response without changing current proof or hint',
    async ({ response }) => {
      let generation = 1;
      const pending = deferred<BrowserFetchResponse>();
      const started = deferred<void>();
      let calls = 0;
      const transport = createBrowserTransport({
        identityFence: { snapshot: () => generation, isCurrent: (value) => value === generation },
        fetch: async (url, init) => {
          calls += 1;
          if (url === '/api/auth/identity') {
            started.resolve();
            return pending.promise;
          }
          expect(init.headers['x-csrf-token']).toBe('current-session');
          return reply();
        },
      });
      const identity = transport.request({ method: 'GET', path: '/api/auth/identity' });
      await started.promise;
      generation = 2;
      transport.rememberBrowserProof('current-session', 'session');
      if (response instanceof Error) pending.reject(response);
      else pending.resolve(response);
      await expect(identity).rejects.toBeInstanceOf(StaleResponseError);
      expect(transport.currentBrowserProof()).toBe('current-session');
      expect(transport.csrfLookupHint()).toBe('unknown');
      await transport.request({ method: 'POST', path: '/write' });
      expect(calls).toBe(2);
    },
  );

  // Mutation: browser-transport.ts updateIdentityProofHint, do not clear the signed-out hint.
  it('h13 a validated signed-in identity discards anonymous proof and clears the hint', async () => {
    const io = network(
      reply({ success: true, data: { authenticated: true, user: PROFILE } }),
      reply({ success: true, data: { token: 'session-proof' } }),
      reply(),
    );
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberNoSession();
    transport.rememberBrowserProof('anonymous', 'pre-session');
    await transport.request({ method: 'GET', path: '/api/auth/identity' });
    expect(transport.currentBrowserProof()).toBe('');
    expect(transport.csrfLookupHint()).toBe('unknown');
    await transport.request({ method: 'POST', path: '/write' });
    expect(io.sent.map(({ url }) => url)).toEqual([
      '/api/auth/identity',
      '/api/auth/csrf',
      '/write',
    ]);
  });
});
