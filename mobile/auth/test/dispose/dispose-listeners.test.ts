import { REFRESH_1_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { createBearerTransport } from '../../src/transport/bearer-transport';
import { AuthRuntime } from '../../src/runtime/runtime';
import type { RuntimeTokens } from '../../src/types/record';
import { CONFIG, ScriptedTransport, apiReply, testPorts } from '../support/support';

describe('dispose listener lifetime', () => {
  it('does not notify a listener removed during disposal', () => {
    const runtime = new AuthRuntime(CONFIG, testPorts(new ScriptedTransport()));
    const calls: string[] = [];
    let unsubscribeLater = (): void => undefined;
    runtime.onDispose(() => {
      calls.push('first');
      unsubscribeLater();
    });
    unsubscribeLater = runtime.onDispose(() => calls.push('removed'));

    runtime.dispose();

    expect(calls).toEqual(['first']);
    expect(runtime.disposeListenerCount).toBe(0);
  });

  it('contains throwing listeners, clears listeners, and invokes a late subscriber once', () => {
    const runtime = new AuthRuntime(CONFIG, testPorts(new ScriptedTransport()));
    const calls: string[] = [];
    runtime.onDispose(() => {
      throw new Error('listener failed');
    });
    runtime.onDispose(() => calls.push('after throw'));

    runtime.dispose();
    runtime.onDispose(() => calls.push('late'));

    expect(calls).toEqual(['after throw', 'late']);
    expect(runtime.disposeListenerCount).toBe(0);
  });

  it('unregisters each request listener as its response settles', async () => {
    const raw = new ScriptedTransport();
    const runtime = new AuthRuntime(CONFIG, testPorts(raw));
    const tokens: RuntimeTokens = {
      accessToken: 'access-1',
      refreshToken: REFRESH_1_TOKEN,
      version: 1,
      expiresAt: 500_000,
      lineageId: 'dispose-listener-lineage',
    };
    runtime.tokens = tokens;
    runtime.setState('signedIn', 'none');
    const transport = createBearerTransport(
      runtime,
      async () => tokens,
      async () => tokens,
    );
    raw.respond = async () => apiReply({ id: 'profile' });

    for (let request = 0; request < 300; request += 1) {
      await transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' });
    }

    expect(runtime.disposeListenerCount).toBe(0);
    runtime.dispose();
  });
});
