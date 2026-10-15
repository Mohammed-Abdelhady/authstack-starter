import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client';
import { SdkError } from '../errors';
import {
  createBrowserTransport,
  createOperationHandle,
  isUnknownOutcomeError,
  UnknownOutcomeError,
  type OperationHandle,
} from '../browser-transport';
import type { BrowserFetchResponse, BrowserRequest } from './types';
import { network, refusal, reply } from './test-support';

const BODY = {
  email: 'mona@example.com',
  name: 'Mona',
  password: 'test-password',
  role: 'support',
};

describe('local logical create operations', () => {
  // Mutation: operations.ts secureOperationKey, drop the getRandomValues fallback.
  // Mutation: areas/admin.ts accounts.create, drop async so a refused key throws.
  it('keys a create from randomUUID or getRandomValues and rejects one with neither', async () => {
    try {
      vi.stubGlobal('crypto', { randomUUID: () => 'opaque-uuid' });
      expect(createOperationHandle()).toEqual({ operationKey: 'opaque-uuid' });
      vi.stubGlobal('crypto', {
        getRandomValues: (bytes: Uint8Array) => bytes.set(bytes.map((_, index) => index)),
      });
      expect(createOperationHandle()).toEqual({
        operationKey: '00010203-0405-4607-8809-0a0b0c0d0e0f',
      });
      for (const cryptoPort of [undefined, { randomUUID: 42 }]) {
        vi.stubGlobal('crypto', cryptoPort);
        const io = network();
        const create = createApiClient(
          createBrowserTransport({ fetch: io.fetch }),
        ).admin.accounts.create(BODY);
        await expect(create).rejects.toBeInstanceOf(SdkError);
        expect(io.sent).toEqual([]);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Mutation: io.ts fetchInit, serialize the caller's mutable body again for a retry.
  it('h16 freezes the dispatched JSON body across a proof retry', async () => {
    const body = { name: 'original' };
    const sentBodies: (string | undefined)[] = [];
    let writes = 0;
    const browser = createBrowserTransport({
      fetch: async (url, init) => {
        if (url === '/api/auth/csrf') {
          body.name = 'changed while loading proof';
          return reply({ success: true, data: { token: 'fresh' } });
        }
        sentBodies.push(init.body);
        writes += 1;
        return writes === 1 ? refusal('CSRF_INVALID') : reply();
      },
    });
    browser.rememberBrowserProof('old', 'session');
    await browser.request({ method: 'POST', path: '/write', body });
    expect(sentBodies).toEqual(['{"name":"original"}', '{"name":"original"}']);
  });

  // Mutation: browser-transport.ts send, allocate another key/body for the CSRF retry.
  it('h16 allocates once per create and keeps key and body through the CSRF retry', async () => {
    const createOperationKey = vi
      .fn<() => string>()
      .mockReturnValueOnce('first-operation')
      .mockReturnValueOnce('second-operation');
    const io = network(
      refusal('CSRF_REQUIRED'),
      reply({ success: true, data: { token: 'fresh' } }),
      new Error('retried answer lost'),
      reply({ success: true, data: { id: 'created-2' } }),
    );
    const browser = createBrowserTransport({ fetch: io.fetch });
    browser.rememberBrowserProof('old', 'session');
    const requests: BrowserRequest[] = [];
    const client = createApiClient({
      request: (request) => {
        requests.push(request);
        return browser.request(request);
      },
    });
    const failure: unknown = await client.admin.accounts
      .create(BODY, { createOperationKey })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnknownOutcomeError);
    if (!(failure instanceof UnknownOutcomeError)) throw failure;
    await client.admin.accounts.create(BODY, { createOperationKey });
    const first = requests[0];
    const second = requests[1];
    expect(typeof first?.operationKey).toBe('string');
    expect(typeof second?.operationKey).toBe('string');
    expect(failure.operationKey).toBe(first?.operationKey);
    expect(second?.operationKey).not.toBe(first?.operationKey);
    expect(createOperationKey).toHaveBeenCalledTimes(2);
    expect(io.sent.map(({ init }) => init.body)).toEqual([
      '{"email":"mona@example.com","name":"Mona","password":"test-password","role":"support"}',
      undefined,
      '{"email":"mona@example.com","name":"Mona","password":"test-password","role":"support"}',
      '{"email":"mona@example.com","name":"Mona","password":"test-password","role":"support"}',
    ]);
    for (const { init } of io.sent) {
      expect(Object.keys(init.headers).sort()).toEqual(
        init.method === 'GET'
          ? ['Accept', 'Content-Type']
          : ['Accept', 'Content-Type', 'x-csrf-token'],
      );
      expect(init.credentials).toBe('include');
      expect(init.headers['Content-Type']).toBe('application/json');
    }
  });

  // Mutation: areas/admin.ts createCall, ignore the supplied operation handle.
  it('h17 returns an unknown operation key and accepts its handle on explicit resumption', async () => {
    const io = network(new Error('answer lost'), new Error('answer lost'));
    const browser = createBrowserTransport({ fetch: io.fetch });
    browser.rememberBrowserProof('session', 'session');
    const client = createApiClient(browser);
    const operation: OperationHandle = { operationKey: 'resume-account-1' };
    await expect(client.admin.accounts.create(BODY, { operation })).rejects.toMatchObject({
      unknownOutcome: true,
      operationKey: 'resume-account-1',
      retryable: false,
    });
    expect(io.sent).toHaveLength(1);
    await expect(client.admin.accounts.create(BODY, { operation })).rejects.toMatchObject({
      unknownOutcome: true,
      operationKey: 'resume-account-1',
      retryable: false,
    });
    expect(io.sent).toHaveLength(2);
  });

  const GATEWAY_TIMEOUT_PAGE: BrowserFetchResponse = {
    status: 504,
    headers: { get: () => null },
    text: async () => '<html>Gateway Timeout</html>',
  };

  // Mutation: areas/admin.ts settleWrite, rethrow a 5xx ApiError unchanged.
  it.each([
    {
      answer: 'a JSON 503 TRANSACTION_OUTCOME_UNKNOWN',
      response: refusal('TRANSACTION_OUTCOME_UNKNOWN', 503),
      expected: { status: 503, cause: { code: 'TRANSACTION_OUTCOME_UNKNOWN' } },
    },
    {
      answer: 'an HTML 504 from a gateway',
      response: GATEWAY_TIMEOUT_PAGE,
      expected: { status: 504 },
    },
  ])('h2 reports $answer to a create as unknown with its key', async ({ response, expected }) => {
    const io = network(response);
    const browser = createBrowserTransport({ fetch: io.fetch });
    browser.rememberBrowserProof('session', 'session');
    const failure: unknown = await createApiClient(browser)
      .admin.accounts.create(BODY, { createOperationKey: () => 'lost-create-1' })
      .catch((error: unknown) => error);

    expect(isUnknownOutcomeError(failure)).toBe(true);
    expect(failure).toMatchObject({ ...expected, operationKey: 'lost-create-1', retryable: false });
    expect(io.sent.map(({ url, init }) => `${init.method} ${url}`)).toEqual([
      'POST /api/admin/users',
    ]);
  });
});
