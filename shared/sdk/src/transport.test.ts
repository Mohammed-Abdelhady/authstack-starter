import { describe, expect, it } from 'vitest';
import { createApiClient } from './client';
import { answering } from './test-support';

describe('Transport headers', () => {
  it('leaves header selection to the injected transport', async () => {
    const transport = answering(200, {});

    await createApiClient(transport).oauth.revoke({ token: ['refresh', 'token'].join('-') });

    expect(transport.sent).toHaveLength(1);
    for (const request of transport.sent) expect(request.headers).toBeUndefined();
  });
});
