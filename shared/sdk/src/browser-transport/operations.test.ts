import { describe, expect, it, vi } from 'vitest';
import { SdkError } from '../errors';
import { createBrowserTransport, createOperationHandle } from '../browser-transport';
import { refusal, reply } from './test-support';

describe('local logical create operations', () => {
  // Mutation: operations.ts secureOperationKey, bypass the guarded crypto UUID port.
  it('uses the structural secure UUID port and refuses unavailable entropy', () => {
    const randomUUID = vi.fn(() => 'opaque-uuid');
    vi.stubGlobal('crypto', { randomUUID });
    try {
      expect(createOperationHandle()).toEqual({ operationKey: 'opaque-uuid' });
      expect(randomUUID).toHaveBeenCalledTimes(1);
      for (const crypto of [undefined, { randomUUID: 42 }]) {
        vi.stubGlobal('crypto', crypto);
        expect(() => createOperationHandle()).toThrow(SdkError);
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
});
