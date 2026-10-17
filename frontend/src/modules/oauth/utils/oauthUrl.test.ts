import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/store/store';
import { baseApi } from '@/store/api/baseApi';
import { CSRF_HEADER, clearBrowserProof, rememberBrowserProof } from '@/store/api/browser-proof';
import { API_BASE_URL } from '@/constants/api';
import { buildOAuthStartUrl, startOAuthFlow } from './oauthUrl';

describe('buildOAuthStartUrl', () => {
  it('starts a login without an intent query', () => {
    expect(buildOAuthStartUrl('google', '/dashboard')).toBe(
      `${API_BASE_URL}/api/auth/oauth/google/start?redirect=%2Fdashboard`,
    );
  });

  it('carries the native authorize continuation to the provider start route', () => {
    expect(buildOAuthStartUrl('google', '/auth/native/authorize?transaction=txn-abc123')).toBe(
      `${API_BASE_URL}/api/auth/oauth/google/start?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-abc123`,
    );
  });
});

interface OAuthStartFetch {
  method: string;
  path: string;
  redirect: string | null;
  intent: string | null;
  credentials: RequestCredentials;
  proof: string | null;
}

afterEach(() => {
  store.dispatch(baseApi.util.resetApiState());
  clearBrowserProof();
  vi.unstubAllGlobals();
});

describe('OAuth fetch start handoff', () => {
  // Catches returning to web by navigating to the legacy start instead of POSTing.
  it('sends a credentialed POST with browser proof before navigating to the returned provider URL', async () => {
    const assign = vi.fn();
    const sent: OAuthStartFetch[] = [];
    vi.stubGlobal('window', { location: { assign } });
    rememberBrowserProof('held-session-proof', 'session');
    vi.stubGlobal('fetch', async (request: Request) => {
      const url = new URL(request.url);
      sent.push({
        method: request.method,
        path: url.pathname,
        redirect: url.searchParams.get('redirect'),
        intent: url.searchParams.get('intent'),
        credentials: request.credentials,
        proof: request.headers.get(CSRF_HEADER),
      });
      return Response.json({
        success: true,
        data: { url: 'https://provider.example/authorize?state=server-state' },
      });
    });

    await startOAuthFlow('google', '/en/settings', 'link');

    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/api/auth/oauth/google/start',
        redirect: '/en/settings',
        intent: 'link',
        credentials: 'include',
        proof: 'held-session-proof',
      },
    ]);
    expect(assign.mock.calls).toEqual([['https://provider.example/authorize?state=server-state']]);
  });

  // Catches a refused or unavailable start still handing control to a provider.
  it('does not navigate when the start request is refused', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    rememberBrowserProof('held-session-proof', 'session');
    vi.stubGlobal('fetch', async () =>
      Response.json(
        {
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Unavailable' },
        },
        { status: 503 },
      ),
    );

    await expect(startOAuthFlow('google', '/en/dashboard')).rejects.toMatchObject({
      status: 503,
    });
    expect(assign).not.toHaveBeenCalled();
  });
});
