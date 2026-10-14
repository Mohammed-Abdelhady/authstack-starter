import { REFRESH_1_TOKEN } from '../support/token-values';
import { HTTP_METHOD } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

describe('foreground timing', () => {
  it('waits until the next request to refresh after time advances', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(1);
    transport.enqueue(oauthTokenReply('access-1', REFRESH_1_TOKEN), apiReply({ id: 'profile' }));
    await engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });

    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(2);
    expect(engine.snapshot.status).toBe('signedIn');
  });
});
