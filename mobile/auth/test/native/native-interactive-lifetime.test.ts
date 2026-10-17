import { assert, describe, expect, it } from 'vitest';
import type { AuthBrowserResult } from '../../src';
import { BROWSER_AUTHORIZATION_TIMEOUT_MS } from '../../src/constants';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  readQueryValues,
  testPorts,
  redirectFrom,
  oauthTokenReply,
  successUserReply,
  REFRESH_TOKEN,
} from '../support/support';
import { ATTEMPT_ID, startReply } from './native-fixtures';
import { GOOGLE_METHODS, drainMethods } from './native-methods-fixtures';
import {
  INTERACTIVE_KIND,
  NETWORK_TIMEOUT_MS,
  interactiveScenario,
} from './native-interactive-fixtures';

describe('native interactive lifetime', () => {
  it.each(INTERACTIVE_KIND)(
    'keeps the %s prompt owned beyond the network deadline',
    async (kind) => {
      const scenario = await interactiveScenario(kind);
      const { engine, ports, transport } = scenario;
      let settled = false;
      const action = engine.nativeSignIn(scenario.action).then((value) => {
        settled = true;
        return value;
      });
      await scenario.prompted.promise;
      ports.clock.advance(NETWORK_TIMEOUT_MS + 1);
      ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
      await drainMethods();
      const premature = settled;
      const overlapping = engine.nativeSignIn(scenario.action);
      scenario.complete(true);
      const [result, overlap] = await Promise.all([action, overlapping]);
      await drainMethods();
      engine.dispose();
      expect(premature).toBe(false);
      expect(overlap).toEqual({ kind: 'busy' });
      expect(result.kind).toBe('continue');
      const proof = transport.sent.find(({ path }) =>
        path.endsWith(
          kind === 'provider'
            ? '/provider'
            : kind === 'mfaPasskey'
              ? '/second-factor'
              : '/passkey/verify',
        ),
      );
      expect(proof?.signal?.aborted).toBe(true);
      expect(ports.timer.pending).toBe(0);
      engine.dispose();
    },
  );

  it.each([
    { locale: 'en' as const, completion: 'cancelled' },
    { locale: 'en' as const, completion: 'success' },
    { locale: 'ar' as const, completion: 'success' }, // feature:locale-ar
    { locale: 'en' as const, completion: 'expired' },
    { locale: 'en' as const, completion: 'disposed' },
  ])('keeps $locale fallback ownership for $completion past15s', async ({ locale, completion }) => {
    const success = completion === 'success';
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const browser = new Deferred<AuthBrowserResult>();
    const opened = new Deferred<void>();
    ports.authBrowser.beforeOpen = () => opened.resolve();
    ports.authBrowser.results.push(() => browser.promise);
    transport.respond = async (request) => {
      if (request.path === '/api/oauth/token') return oauthTokenReply();
      if (request.path === '/api/user/profile') return successUserReply();
      if (request.path.endsWith('/attempts')) return startReply(expiresAt);
      if (request.path.includes('/methods')) return apiReply(GOOGLE_METHODS);
      return apiReply({ attemptId: ATTEMPT_ID, stage: 'denied', expiresAt, reason: 'cancelled' });
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const saved = JSON.parse(ports.credentials.value ?? '{}') as { transaction: { state: string } };
    let settled = false;
    const action = engine
      .nativeSignIn({ kind: 'provider', providerId: 'google', locale })
      .then((value) => {
        settled = true;
        return value;
      });
    await opened.promise;
    ports.clock.advance(NETWORK_TIMEOUT_MS + 1);
    ports.timer.fireDelay(NETWORK_TIMEOUT_MS);
    await drainMethods();
    const premature = settled;
    assert.isDefined(ports.authBrowser.opened[0]);
    const query = readQueryValues(ports.authBrowser.opened[0].address);
    if (completion === 'expired') {
      ports.clock.advance(BROWSER_AUTHORIZATION_TIMEOUT_MS - NETWORK_TIMEOUT_MS - 1);
      ports.timer.fireDelay(BROWSER_AUTHORIZATION_TIMEOUT_MS);
    }
    if (completion === 'disposed') engine.dispose();
    browser.resolve(
      completion !== 'cancelled'
        ? {
            kind: 'redirect',
            url: redirectFrom(ports.authBrowser.opened[0].address, { code: 'browser-code' }),
          }
        : { kind: 'cancelled' },
    );
    const result = await action;
    await drainMethods();
    const remainingTimers = ports.timer.pending;
    const persisted = ports.credentials.value;
    const status = engine.snapshot.status;
    engine.dispose();
    expect(premature).toBe(false);
    expect(query.get('provider_id')).toBe('google');
    expect(query.get('locale')).toBe(locale);
    expect(query.get('state')).not.toBe(saved.transaction.state);
    expect(ports.timer.scheduled).toContain(BROWSER_AUTHORIZATION_TIMEOUT_MS);
    expect(result.kind).toBe(success ? 'signedIn' : completion);
    if (success) {
      expect(persisted).toContain(REFRESH_TOKEN);
      expect(status).toBe('signedIn');
    }
    expect(transport.sent.filter(({ path }) => path === '/api/oauth/token')).toHaveLength(
      success ? 1 : 0,
    );
    expect(ports.authBrowser.opened).toHaveLength(1);
    expect(remainingTimers).toBe(0);
  });
});
