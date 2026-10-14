import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { OAUTH_REFRESH_TIMEOUT_MS } from '../../src/constants';
import { AuthPortError } from '../../src/errors/errors';
import { createAuthEngine } from '../support/engine';
import {
  REFRESH_TOKEN,
  CONFIG,
  ScriptedTransport,
  establishSession,
  testPorts,
} from '../support/support';

describe('a refresh deadline that fails before the request is sent', () => {
  it('clears the unsent marker and keeps the current session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    const schedule = ports.timer.after.bind(ports.timer);
    ports.timer.after = (milliseconds, callback) => {
      if (milliseconds === OAUTH_REFRESH_TIMEOUT_MS) throw new Error('timer unavailable');
      return schedule(milliseconds, callback);
    };

    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(AuthPortError);

    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
    expect(ports.credentials.value).toContain(REFRESH_TOKEN);
    expect(ports.credentials.value).not.toContain('"refreshInFlight":true');
    expect(
      transport.sent.filter(
        ({ path, body }) =>
          path === '/api/oauth/token' &&
          typeof body === 'object' &&
          body !== null &&
          'grant_type' in body &&
          body.grant_type === 'refresh_token',
      ),
    ).toHaveLength(0);
    expect(ports.timer.pending).toBe(0);
  });
});
