import { describe, expect, it } from 'vitest';
import { createBrowserTransport, UnknownOutcomeError } from '../browser-transport';
import type { BrowserFetchResponse } from './types';
import { deferred, network, refusal, reply } from './test-support';

const WRITE = { method: 'POST', path: '/api/admin/users', body: { name: 'Mona' } };

describe('browser proof lifecycle', () => {
  // Mutation: io.ts joinUrl, concatenate the base and path without slash normalization.
  it('joins a trailing-slash origin and relative routes without changing proof lookup paths', async () => {
    const io = network(reply({ success: true, data: { token: 'session' } }), reply(), reply());
    const transport = createBrowserTransport({ fetch: io.fetch, baseUrl: 'https://api.test/' });
    await transport.request(WRITE);
    await transport.request({ method: 'GET', path: 'api/roles' });
    expect(io.sent.map(({ url }) => url)).toEqual([
      'https://api.test/api/auth/csrf',
      'https://api.test/api/admin/users',
      'https://api.test/api/roles',
    ]);
  });

  // Mutation: browser-transport.ts send, return the first CSRF refusal without retrying.
  it('h1 recovers a refused write with one fresh proof', async () => {
    const io = network(
      refusal('CSRF_INVALID'),
      reply({ success: true, data: { token: 'fresh' } }),
      reply({ success: true, data: { id: 'created' } }),
    );
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('old', 'session');
    const result = await transport.request(WRITE);
    expect(result.body).toEqual({ success: true, data: { id: 'created' } });
    expect(io.sent).toHaveLength(3);
    expect(io.sent.at(-1)?.init.headers['x-csrf-token']).toBe('fresh');
  });

  // Mutation: browser-transport.ts send, remove the single explicit-CSRF retry.
  it.each(['CSRF_INVALID', 'CSRF_REQUIRED'])(
    'h1 replaces %s proof once and exposes a second refusal',
    async (code) => {
      const io = network(
        refusal(code),
        reply({ success: true, data: { token: 'replacement' } }),
        refusal(code),
      );
      const transport = createBrowserTransport({ fetch: io.fetch, baseUrl: 'https://api.test' });
      transport.rememberBrowserProof('old', 'session');
      await expect(transport.request(WRITE)).resolves.toMatchObject({
        status: 403,
        body: { success: false, error: { code } },
      });
      expect(
        io.sent.map(({ url, init }) => ({ url, proof: init.headers['x-csrf-token'] })),
      ).toEqual([
        { url: 'https://api.test/api/admin/users', proof: 'old' },
        { url: 'https://api.test/api/auth/csrf', proof: undefined },
        { url: 'https://api.test/api/admin/users', proof: 'replacement' },
      ]);
    },
  );

  // Mutation: browser-transport.ts send, dispatch a write before acquiring its required proof.
  it.each([
    { name: 'outage', response: new Error('offline') },
    { name: 'refusal', response: refusal('FORBIDDEN') },
    { name: 'missing token', response: reply() },
  ])('h9 stops before dispatch on proof $name without unknown outcome', async ({ response }) => {
    const io = network(response);
    const transport = createBrowserTransport({ fetch: io.fetch });
    const error: unknown = await transport.request(WRITE).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnknownOutcomeError);
    expect(io.sent.map(({ url }) => url)).toEqual(['/api/auth/csrf']);
  });

  // Mutation: proofs.ts sessionMissing condition, fall back without checking status or code.
  it.each([refusal('SESSION_REQUIRED', 401), refusal('CSRF_INVALID')])(
    'falls back only for absent or invalid session proof',
    async (missing) => {
      const io = network(missing, reply({ success: true, data: { token: 'anonymous' } }), reply());
      const transport = createBrowserTransport({ fetch: io.fetch });
      await transport.request(WRITE);
      expect(io.sent.map(({ url }) => url)).toEqual([
        '/api/auth/csrf',
        '/api/auth/browser-proof',
        '/api/admin/users',
      ]);
      expect(io.sent.at(-1)?.init.headers['x-csrf-token']).toBe('anonymous');
    },
  );

  // Mutation: proof-state.ts takeBrowserProof, retain a pre-session token after taking it.
  it('h10 reuses a session proof and consumes a pre-session proof once', async () => {
    const io = network(
      reply(),
      reply(),
      reply(),
      reply({ success: true, data: { token: 'fresh' } }),
      reply(),
    );
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    await transport.request(WRITE);
    await transport.request(WRITE);
    transport.rememberNoSession();
    transport.rememberBrowserProof('one-use', 'pre-session');
    await transport.request(WRITE);
    await transport.request(WRITE);
    expect(io.sent.map(({ init }) => init.headers['x-csrf-token'])).toEqual([
      'session',
      'session',
      'one-use',
      undefined,
      'fresh',
    ]);
    expect(transport.currentBrowserProof()).toBe('');
  });

  // Mutation: proofs.ts loadBrowserProof, yield between remembering and taking a pre-session proof.
  it('h11 gives concurrent anonymous writes distinct single-use proofs', async () => {
    const lookups = [deferred<BrowserFetchResponse>(), deferred<BrowserFetchResponse>()];
    let lookupIndex = 0;
    const proofs: (string | undefined)[] = [];
    const transport = createBrowserTransport({
      fetch: async (url, init) => {
        if (url === '/api/auth/browser-proof') {
          const pending = lookups[lookupIndex];
          lookupIndex += 1;
          if (!pending) throw new Error('Unexpected proof lookup');
          return pending.promise;
        }
        proofs.push(init.headers['x-csrf-token']);
        return reply();
      },
    });
    transport.rememberNoSession();
    const first = transport.request(WRITE);
    const second = transport.request(WRITE);
    lookups[0]?.resolve(reply({ success: true, data: { token: 'first' } }));
    lookups[1]?.resolve(reply({ success: true, data: { token: 'second' } }));
    await Promise.all([first, second]);
    expect(proofs).toEqual(['first', 'second']);
  });

  // Mutation: browser-transport.ts factory, hoist proof state outside the instance.
  it('h12 isolates proofs, hints and identity fences across instances', async () => {
    const a = network(reply());
    const b = network(reply({ success: true, data: { token: 'b' } }), reply());
    const first = createBrowserTransport({
      fetch: a.fetch,
      identityFence: { snapshot: () => 1, isCurrent: () => false },
    });
    const second = createBrowserTransport({
      fetch: b.fetch,
      identityFence: { snapshot: () => 2, isCurrent: () => true },
    });
    first.rememberBrowserProof('a', 'session');
    second.rememberNoSession();
    await second.request(WRITE);
    expect(first.currentBrowserProof()).toBe('a');
    expect(first.csrfLookupHint()).toBe('unknown');
    expect(b.sent[0]?.url).toBe('/api/auth/browser-proof');
    await expect(
      first.request({ method: 'GET', path: '/api/auth/identity' }),
    ).rejects.toMatchObject({ name: 'StaleResponseError' });
    expect(second.csrfLookupHint()).toBe('no-session');
  });

  // Mutation: proof-state.ts rememberBrowserProof, keep the no-session hint on a session proof.
  it('h13 clears the signed-out lookup hint after sign-in issues a session proof', async () => {
    const io = network(
      reply({ success: true, data: { authenticated: false, user: null } }),
      reply({ success: true, data: { token: 'anonymous' } }),
      reply({}, 200, 'signed-in'),
      reply(),
    );
    const transport = createBrowserTransport({ fetch: io.fetch });
    await transport.request({ method: 'GET', path: '/api/auth/identity' });
    expect(transport.csrfLookupHint()).toBe('no-session');
    await transport.request({ ...WRITE, path: '/api/auth/login' });
    expect(transport.csrfLookupHint()).toBe('unknown');
    await transport.request(WRITE);
    expect(io.sent.map(({ url }) => url)).toEqual([
      '/api/auth/identity',
      '/api/auth/browser-proof',
      '/api/auth/login',
      '/api/admin/users',
    ]);
    expect(io.sent.at(-1)?.init.headers['x-csrf-token']).toBe('signed-in');
  });

  // Mutation: proofs.ts issuedToken, prefer a body token or accept one from an unrelated route.
  it('prefers the header and ignores token-shaped bodies outside proof endpoints', async () => {
    const io = network(
      reply({ success: true, data: { token: 'body' } }, 200, 'header'),
      reply({ success: true, data: { token: 'unrelated' } }),
    );
    const transport = createBrowserTransport({ fetch: io.fetch });
    await transport.request({ method: 'GET', path: '/api/auth/csrf' });
    expect(transport.currentBrowserProof()).toBe('header');
    await transport.request({ method: 'GET', path: '/api/other' });
    expect(transport.currentBrowserProof()).toBe('header');
  });

  // Mutation: browser-transport.ts logout finalizer, use a substring match.
  it('h15 clears proof only on the exact logout URL including a refusal', async () => {
    const io = network(reply(), refusal('FORBIDDEN'));
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    await transport.request({ method: 'GET', path: '/other/api/auth/logout/path' });
    expect(transport.currentBrowserProof()).toBe('session');
    await expect(
      transport.request({ method: 'POST', path: '/api/auth/logout' }),
    ).resolves.toMatchObject({ status: 403 });
    expect(transport.currentBrowserProof()).toBe('');
  });
});
