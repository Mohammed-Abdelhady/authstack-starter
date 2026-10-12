import { describe, expect, it } from 'vitest';
import { API_BASE_URL } from '@/constants/api';
import { readNativeBrowserSelectors } from '../../utils/nativeBrowserSelectors';
import { nativeBrowserSignInTarget } from '../../utils/nativeBrowserSignIn';

describe('native browser selector reader', () => {
  it('preserves selector-free login', () => {
    const selectors = readNativeBrowserSelectors({ transaction: 'txn-1' });
    expect(selectors).toEqual({});
    expect(nativeBrowserSignInTarget('txn-1', selectors ?? undefined)).toEqual({
      kind: 'page',
      href: '/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1',
    });
  });

  // feature:oauth-core:start
  it('passes parsed selectors to the actual provider-start builder and strips them on return', () => {
    const query = Object.fromEntries(
      new URLSearchParams('transaction=txn-1&provider_id=team-sso&flow=signIn&locale=en'),
    );
    const selectors = readNativeBrowserSelectors(query);
    expect(selectors).toEqual({ providerId: 'team-sso', flow: 'signIn', locale: 'en' });
    if (!selectors) throw new Error('The valid selection was rejected');
    expect(nativeBrowserSignInTarget('txn-1', selectors)).toEqual({
      kind: 'provider',
      href: `${API_BASE_URL}/api/auth/oauth/team-sso/start?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn-1`,
    });
  });
  // feature:oauth-core:end

  it.each([
    null,
    undefined,
    [],
    'provider_id=google',
    { provider_id: '' },
    { provider_id: ['google', 'google'] },
    { provider_id: 'https://evil.example' },
    { provider_id: '../google' },
    { provider_id: 'google?intent=link' },
    { 'provider_id[id]': 'google' },
    { flow: '' },
    { flow: 'link' },
    { flow: ['signIn', 'recovery'] },
    { locale: '' },
    { locale: 'en-US' },
    { locale: ['en', 'en'] },
    { provider_id: 'google', flow: 'registration' },
    { provider_id: 'google', flow: 'recovery' },
  ])('refuses malformed or conflicting selectors %j', (query) => {
    expect(readNativeBrowserSelectors(query)).toBeNull();
  });

  it.each([
    'signIn',
    'registration', // feature:email-password
    'recovery', // feature:email-password
  ])('accepts the exact %s flow', (flow) => {
    expect(readNativeBrowserSelectors({ flow })).toEqual({ flow });
  });

  // feature:locale-ar:start
  it('accepts Arabic without rewriting it', () => {
    expect(readNativeBrowserSelectors({ locale: 'ar' })).toEqual({ locale: 'ar' });
  });
  // feature:locale-ar:end

  it('keeps transaction characters inside the return query value', () => {
    expect(nativeBrowserSignInTarget('txn&provider_id=evil')).toEqual({
      kind: 'page',
      href: '/auth/login?redirect=%2Fauth%2Fnative%2Fauthorize%3Ftransaction%3Dtxn%2526provider_id%253Devil',
    });
  });
});
