import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { OAuthError } from '../errors';
import { createBrowserTransport, UnknownOutcomeError } from '../browser-transport';
import { network, reply } from './test-support';

describe('received browser responses', () => {
  // Mutation: browser-transport.ts request, reject HTTP errors before the OAuth reader runs.
  it.each([
    { error: 'invalid_grant', nonce: undefined },
    { error: 'use_dpop_nonce', nonce: 'server-nonce' },
  ])('keeps OAuth $error and the challenge nonce through the client', async ({ error, nonce }) => {
    const io = network({
      status: 400,
      headers: { get: (name) => (name === 'dpop-nonce' ? (nonce ?? null) : null) },
      text: async () => JSON.stringify({ error }),
    });
    const transport = createBrowserTransport({ fetch: io.fetch });
    transport.rememberBrowserProof('session', 'session');
    const failure: unknown = await createApiClient(transport)
      .oauth.revoke({ token: 'refresh-token' })
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(OAuthError);
    expect(failure).toMatchObject({ status: 400, error, dpopNonce: nonce });
    expect(io.sent).toHaveLength(1);
  });

  // Mutation: io.ts dispatchBrowserRequest, check abortion after the completed body read.
  it.each([201, 409])(
    'keeps a known %s write answer when cancellation follows the body',
    async (status) => {
      const signal = { aborted: false };
      const io = network({
        status,
        headers: { get: () => null },
        text: async () => {
          signal.aborted = true;
          return '{"answer":"known"}';
        },
      });
      const transport = createBrowserTransport({ fetch: io.fetch });
      transport.rememberBrowserProof('session', 'session');
      await expect(
        transport.request({ method: 'POST', path: '/write', signal }),
      ).resolves.toMatchObject({ status, body: { answer: 'known' }, unknownOutcome: false });
      expect(io.sent).toHaveLength(1);
    },
  );

  // Mutation: io.ts dispatchBrowserRequest, remove the abort check before reading the body.
  it('does not start reading a body after a dispatched write was aborted', async () => {
    const signal = { aborted: false };
    let bodyReads = 0;
    let dispatches = 0;
    const transport = createBrowserTransport({
      fetch: async () => {
        dispatches += 1;
        signal.aborted = true;
        return {
          status: 201,
          headers: { get: () => null },
          text: async () => {
            bodyReads += 1;
            return '{"answer":"known"}';
          },
        };
      },
    });
    transport.rememberBrowserProof('session', 'session');
    await expect(
      transport.request({ method: 'POST', path: '/write', signal }),
    ).rejects.toBeInstanceOf(UnknownOutcomeError);
    expect(bodyReads).toBe(0);
    expect(dispatches).toBe(1);
  });

  // Mutation: browser-transport.ts request, throw an API error for a received HTTP refusal.
  it('resolves an ordinary HTTP refusal with issued proof bookkeeping intact', async () => {
    const io = network(reply({ success: false, error: { code: 'FORBIDDEN' } }, 403, 'issued'));
    const transport = createBrowserTransport({ fetch: io.fetch });
    await expect(transport.request({ method: 'GET', path: '/read' })).resolves.toMatchObject({
      status: 403,
      body: { success: false, error: { code: 'FORBIDDEN' } },
    });
    expect(transport.currentBrowserProof()).toBe('issued');
  });
});
