import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { createApiClient } from '../client';
import { createBrowserTransport, UnknownOutcomeError } from '../browser-transport';
import type { BrowserFetchResponse } from './types';
import { deferred, network, refusal, reply } from './test-support';

const WRITE = { method: 'POST', path: '/api/admin/users', body: { name: 'Mona' } };

describe('browser dispatch outcomes', () => {
  // Mutation: io.ts parseBody, attempt JSON parsing for a successful 204 delete.
  it('h21 carries empty 204 deletes through the browser transport and admin reader', async () => {
    const io = network(reply(undefined, 204), reply(undefined, 204));
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    const { admin } = createApiClient(transport);
    await expect(admin.accounts.delete('account-1')).resolves.toBeUndefined();
    await expect(admin.roles.delete('role-1')).resolves.toBeUndefined();
    expect(io.sent.map(({ url }) => url)).toEqual([
      '/api/admin/users/account-1',
      '/api/roles/role-1',
    ]);
  });

  // Mutation: io.ts failureAfterDispatch, classify a dispatched write as TransportError.
  it('h2 reports a committed write timeout as unknown without resending', async () => {
    const committed: unknown[] = [];
    let calls = 0;
    const transport = createBrowserTransport({
      fetch: async (_url, init) => {
        calls += 1;
        committed.push(JSON.parse(init.body ?? 'null'));
        throw new Error('timeout after commit');
      },
    });
    transport.rememberBrowserProof('session', 'session');
    await expect(transport.request(WRITE)).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(committed).toEqual([{ name: 'Mona' }]);
    expect(calls).toBe(1);
  });

  // Mutation: io.ts assertNotAborted, remove the pre-dispatch check.
  it('h5 sends no pre-aborted read and forwards the live signal to cancel I/O', async () => {
    const io = network(reply());
    const transport = createBrowserTransport({ fetch: io.fetch });
    await expect(
      transport.request({ method: 'GET', path: '/read', signal: { aborted: true } }),
    ).rejects.toMatchObject({ reason: 'aborted' });
    expect(io.sent).toHaveLength(0);
    const signal = { aborted: false };
    const pending = deferred<BrowserFetchResponse>();
    let forwarded: unknown;
    const active = createBrowserTransport({
      fetch: async (_url, init) => {
        forwarded = init.signal;
        return pending.promise;
      },
    });
    const read = active.request({ method: 'GET', path: '/read', signal });
    expect(forwarded).toBe(signal);
    signal.aborted = true;
    pending.reject(new Error('I/O cancelled'));
    await expect(read).rejects.toMatchObject({ reason: 'aborted' });
  });

  // Mutation: io.ts failureAfterDispatch, treat an aborted dispatched write as cancelled.
  it('h6 keeps an aborted dispatched write unknown and sends exactly once', async () => {
    const signal = { aborted: false };
    const pending = deferred<BrowserFetchResponse>();
    let calls = 0;
    let forwardedSignal: unknown;
    const transport = createBrowserTransport({
      fetch: async (_url, init) => {
        forwardedSignal = init.signal;
        calls += 1;
        return pending.promise;
      },
    });
    transport.rememberBrowserProof('session', 'session');
    const write = transport.request({ ...WRITE, signal });
    signal.aborted = true;
    pending.reject(new Error('aborted'));
    await expect(write).rejects.toMatchObject({ unknownOutcome: true, retryable: false });
    expect(forwardedSignal).toBe(signal);
    expect(calls).toBe(1);
  });

  // Mutation: io.ts dispatchBrowserRequest, remove the abort check after the proof answer.
  it('h7 abort during proof acquisition never dispatches the mutation', async () => {
    const signal = { aborted: false };
    const pending = deferred<BrowserFetchResponse>();
    const paths: string[] = [];
    const transport = createBrowserTransport({
      fetch: async (url) => {
        paths.push(url);
        return pending.promise;
      },
    });
    const write = transport.request({ ...WRITE, signal });
    signal.aborted = true;
    pending.resolve(reply({ success: true, data: { token: 'late' } }));
    await expect(write).rejects.toMatchObject({ reason: 'aborted' });
    expect(paths).toEqual(['/api/auth/csrf']);
    expect(transport.currentBrowserProof()).toBe('');
  });

  // Mutation: browser-transport.ts isProofFailure, retry every HTTP refusal.
  it.each([
    [403, 'FORBIDDEN', false],
    [403, 'ORIGIN_REJECTED', false],
    [409, 'CONFLICT', false],
    [400, 'VALIDATION_ERROR', false],
    [429, 'RATE_LIMITED', false],
    [503, 'AUTHORITY_UNAVAILABLE', true],
  ] as const)('h8 never retries %s %s', async (status, code, unknownOutcome) => {
    const io = network(refusal(code, status));
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    await expect(transport.request(WRITE)).resolves.toMatchObject({
      status,
      unknownOutcome,
      body: { success: false, error: { code } },
    });
    expect(io.sent).toHaveLength(1);
  });

  // Mutation: browser-transport.ts request, replace a received 401 with a network failure.
  it('h4 preserves signed-out HTTP status', async () => {
    const io = network(refusal('SESSION_REQUIRED', 401));
    const transport = createBrowserTransport({ fetch: io.fetch });
    await expect(createApiClient(transport).profile.get()).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_REQUIRED',
    });
  });

  // Mutation: browser-transport.ts request, discard the original error envelope before resolving.
  it('h18 preserves conflict and dotted validation fields with message arrays', async () => {
    const io = network(
      refusal('ROLE_NAME_TAKEN', 409),
      reply(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'invalid',
            details: { fields: { 'profile.email': ['invalid address', 'already used'] } },
          },
          requestId: 'req-42',
        },
        400,
      ),
    );
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    const client = createApiClient(transport);
    await expect(client.profile.update({ name: 'Mona' })).rejects.toMatchObject({
      status: 409,
      code: 'ROLE_NAME_TAKEN',
    });
    await expect(client.profile.update({ name: 'Mona' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      requestId: 'req-42',
      fields: { 'profile.email': ['invalid address', 'already used'] },
    });
  });

  // Mutation: io.ts failureAfterDispatch, make read and write network errors identical.
  it('h19 distinguishes failed reads from uncertain writes', async () => {
    const io = network(new Error('offline'), new Error('offline'));
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    await expect(transport.request({ method: 'GET', path: '/read' })).rejects.toMatchObject({
      reason: 'no_response',
    });
    await expect(transport.request(WRITE)).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(io.sent).toHaveLength(2);
  });

  // Mutation: io.ts parseBody, return an empty success for malformed JSON.
  it('h20 keeps HTTP refusals and rejects malformed success without retry', async () => {
    const malformed = (status: number): BrowserFetchResponse => ({
      status,
      headers: { get: () => null },
      text: async () => '<html>proxy</html>',
    });
    const io = network(malformed(401), malformed(403), malformed(200), malformed(200));
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    await expect(transport.request(WRITE)).resolves.toMatchObject({ status: 401 });
    await expect(transport.request(WRITE)).resolves.toMatchObject({ status: 403 });
    await expect(transport.request({ method: 'GET', path: '/read' })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(transport.request(WRITE)).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(io.sent).toHaveLength(4);
  });
});
