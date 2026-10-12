import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { OAuthProviderStrategy } from '../../../src/auth/oauth/oauth-provider.interface';

export interface LocalOAuthFixture {
  strategy: OAuthProviderStrategy;
  reset: () => void;
  close: () => Promise<void>;
}

/** A consent boundary for application integration; it never contacts an external provider. */
export async function startLocalOAuth(): Promise<LocalOAuthFixture> {
  const grants = new Set<string>();
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:5108');
    const callback = new URL(
      'http://127.0.0.1:5107/api/auth/oauth/google/callback',
    );
    callback.searchParams.set('state', url.searchParams.get('state') ?? '');
    const choice = url.searchParams.get('choice');
    if (choice) {
      if (choice === 'cancel')
        callback.searchParams.set('error', 'access_denied');
      else {
        const code = randomUUID();
        if (choice === 'continue') grants.add(code);
        callback.searchParams.set('code', code);
      }
      response.writeHead(302, { Location: callback.toString() }).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html lang="en"><title>Local consent fixture</title><main><h1>Local consent fixture</h1>${[
        'continue',
        'cancel',
        'error',
      ]
        .map((action) => {
          const target = new URL(url);
          target.searchParams.set('choice', action);
          return `<a data-testid="consent-${action}" href="${target.pathname + target.search.replaceAll('&', '&amp;')}">${action}</a>`;
        })
        .join(' ')}</main></html>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(5108, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    strategy: {
      id: 'google',
      displayName: 'Local consent fixture',
      envPrefix: 'FIXTURE',
      supportsPkce: true,
      usesOidc: false,
      emailAlwaysVerified: true,
      autoLinksByEmail: true,
      callbackMethod: 'GET',
      isEnabled: () => true,
      getAuthorizationUrl: ({ state }) =>
        `http://127.0.0.1:5108/authorize?state=${encodeURIComponent(state)}`,
      exchangeCode: ({ code }) => {
        if (!grants.delete(code))
          return Promise.reject(new Error('Fixture exchange failed'));
        return Promise.resolve({ accessToken: 'local-fixture-token' });
      },
      fetchProfile: () =>
        Promise.resolve({
          providerId: 'local-fixture-user',
          email: 'oauth@example.test',
          emailVerified: true,
          name: 'Local OAuth User',
        }),
    },
    reset: () => grants.clear(),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
