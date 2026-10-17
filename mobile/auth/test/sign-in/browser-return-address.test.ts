import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { CONFIG, ScriptedTransport, testPorts } from '../support/support';

describe('the return address handed to the browser port', () => {
  it('is the configured redirect address, beside the authorize address', async () => {
    const ports = testPorts(new ScriptedTransport());
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();

    await engine.signIn();

    expect(ports.authBrowser.opened).toHaveLength(1);
    expect(ports.authBrowser.opened[0]?.redirectUri).toBe('sampleapp://auth/callback');
    expect(ports.authBrowser.opened[0]?.address).toContain(
      'https://api.example.test/api/oauth/authorize?',
    );
  });
});
