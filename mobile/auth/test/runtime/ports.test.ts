import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { digestInstallIdentity } from '../../src/storage/persistence';
import {
  CONFIG,
  ScriptedTransport,
  oauthTokenReply,
  readQueryValues,
  successUserReply,
  testPorts,
} from '../support/support';
import { sha256 } from '../support/sha256';

describe('ports and configuration', () => {
  it('validates the configuration once at construction', () => {
    expect(() =>
      createAuthEngine({ ...CONFIG, clientId: '' }, testPorts(new ScriptedTransport())),
    ).toThrow(TypeError);
    expect(() =>
      createAuthEngine(
        { ...CONFIG, redirectUri: 'sampleapp://auth/callback?x=1' },
        testPorts(new ScriptedTransport()),
      ),
    ).toThrow(TypeError);
  });

  it.each(['com.example.app:/cb', 'myapp:///cb', 'myapp://callback'])(
    'accepts custom-scheme callback %s',
    (redirectUri) => {
      expect(() =>
        createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
      ).not.toThrow();
    },
  );

  it('explains callback host and default-port normalization', () => {
    expect(() =>
      createAuthEngine(
        { ...CONFIG, redirectUri: 'https://A.example:443/cb' },
        testPorts(new ScriptedTransport()),
      ),
    ).toThrow(/unchanged by the server URL parser/i);
  });

  it.each(['https://app.example.test', 'https://app.example.test/a/../cb'])(
    'rejects web callback addresses the server rewrites: %s',
    (redirectUri) => {
      expect(() =>
        createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
      ).toThrow(TypeError);
    },
  );

  it('accepts a percent escape the server preserves in a web callback path', () => {
    expect(() =>
      createAuthEngine(
        { ...CONFIG, redirectUri: 'https://app.example.test/%63b' },
        testPorts(new ScriptedTransport()),
      ),
    ).not.toThrow();
  });

  it('allows HTTP only for the server supported loopback hosts', () => {
    expect(() =>
      createAuthEngine(
        { ...CONFIG, serverBaseAddress: 'http://api.example.test' },
        testPorts(new ScriptedTransport()),
      ),
    ).toThrow(/loopback/i);
    for (const redirectUri of ['http://api.example.test/callback']) {
      expect(() =>
        createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
      ).toThrow(/loopback/i);
    }
    expect(() =>
      createAuthEngine(
        { ...CONFIG, redirectUri: 'http://127.001.0.1/callback' },
        testPorts(new ScriptedTransport()),
      ),
    ).toThrow(/unchanged by the server URL parser/i);
    expect(() =>
      createAuthEngine(
        { ...CONFIG, redirectUri: 'http://dev.localhost/callback' },
        testPorts(new ScriptedTransport()),
      ),
    ).not.toThrow();
    expect(() =>
      createAuthEngine(
        {
          ...CONFIG,
          serverBaseAddress: 'http://localhost:4000',
          redirectUri: 'http://127.0.0.1:19000/cb',
        },
        testPorts(new ScriptedTransport()),
      ),
    ).not.toThrow();
  });

  it.each(['javascript://x/cb', 'data://x/cb', 'vbscript://x/cb', 'blob://x/cb', 'file://x/cb'])(
    'refuses a redirect scheme the server does not accept: %s',
    (redirectUri) => {
      expect(() =>
        createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
      ).toThrow(TypeError);
    },
  );

  it.each(['http://localhost:0/callback', 'http://localhost:99999/callback'])(
    'refuses an invalid redirect port: %s',
    (redirectUri) => {
      expect(() =>
        createAuthEngine({ ...CONFIG, redirectUri }, testPorts(new ScriptedTransport())),
      ).toThrow(TypeError);
    },
  );

  it('allows a loopback callback with a runtime-selected port', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const redirectUri = 'http://127.0.0.1:49152/callback';
    ports.authBrowser.results.push((address) => {
      const state = readQueryValues(address).get('state') ?? '';
      return {
        kind: 'redirect',
        url: `${redirectUri}?code=loopback-code&state=${state}`,
      };
    });
    transport.enqueue(oauthTokenReply(), successUserReply());
    const engine = createAuthEngine({ ...CONFIG, redirectUri }, ports);

    await engine.restore();
    const result = await engine.signIn();

    expect(result.kind).toBe('signedIn');
    expect(transport.sent.find(({ path }) => path === '/api/oauth/token')?.body).toMatchObject({
      code: 'loopback-code',
      redirect_uri: redirectUri,
    });
  });

  it('stores a digest of the install id and client id', async () => {
    await expect(
      digestInstallIdentity('id', 'client', { sha256: async (bytes) => sha256(bytes) }),
    ).resolves.toBe('FJCK-A2Sts2abhm3ST3F7JY6eivgb4Q5Iy8HU9BORp4');
  });
});
