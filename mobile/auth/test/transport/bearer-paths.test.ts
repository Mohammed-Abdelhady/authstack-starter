import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, SdkError } from '@app/sdk';
import { UnsafeRequestPathError } from '../../src';
import {
  ACCESS_TOKEN,
  CONFIG,
  ScriptedTransport,
  apiReply,
  establishSession,
  testPorts,
} from '../support/support';
import { createAuthEngine } from '../support/engine';

describe('bearer request paths', () => {
  it.each([
    '//evil.example/x',
    'https://evil.example/x',
    '@evil.example/x',
    '/api/../../x',
    '/api/%2e%2e/x',
    '/api\\evil',
    '/api/a b',
    '/api/unsafe\npath',
    '/api/control\u0001path',
    '/api/./oauth/token',
    '/api/oauth/token#fragment',
    '/api/oauth/token/',
    '/api/oauth//token',
    '/api/items/42#fragment',
    '/api/%2E%2e/oauth/token',
    '/api/%2e%2E/oauth/token',
    '/API/OAUTH/TOKEN%2Fprofile',
    '/Api/OAuth/Revoke%2Fother',
  ])('refuses unsafe paths before attaching a bearer token: %s', async (path) => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;

    const failure = engine.transport.request({ method: HTTP_METHOD.GET, path });
    await expect(failure).rejects.toBeInstanceOf(UnsafeRequestPathError);
    await expect(failure).rejects.toBeInstanceOf(SdkError);
    expect(transport.sent).toHaveLength(0);
  });

  it('allows a colon in a route segment and a URL-like query value', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    transport.enqueue(apiReply({ id: 'urn:uuid:1' }));

    const response = await engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/items/urn:uuid:1?next=https://example.test/items/1',
    });

    expect(response.status).toBe(200);
    expect(transport.sent[0]?.headers?.['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it.each([
    '/api/oauth/token?x=1',
    '/api/oauth/revoke?x=1',
    '/api/oauth/Token',
    '/API/OAUTH/TOKEN',
    '/api/OAuth/revoke',
    '/api/oauth/%74oken',
  ])('keeps bearer credentials off OAuth endpoint variants: %s', async (path) => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    transport.enqueue(apiReply({ id: 'result' }));

    await engine.transport.request({ method: HTTP_METHOD.GET, path });

    expect(transport.sent[0]?.headers?.['Authorization']).toBeUndefined();
  });
});
