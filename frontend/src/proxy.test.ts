import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNPROXIED_SOURCE } from './lib/config/security-headers';
import proxy, { config } from './proxy';

// Next hands a request header the proxy sets to the page under this name.
const FORWARDED = 'x-middleware-request-';
const NONCE_SOURCE = /'nonce-([A-Za-z0-9+/=]+)'/;

function run(path: string, headers: Record<string, string> = {}) {
  const response = proxy(new NextRequest(`http://localhost:3000${path}`, { headers }));
  const policy = response.headers.get('Content-Security-Policy') ?? '';
  return {
    response,
    policy,
    nonce: NONCE_SOURCE.exec(policy)?.[1],
    forwardedNonce: response.headers.get(`${FORWARDED}x-nonce`),
    forwardedPolicy: response.headers.get(`${FORWARDED}content-security-policy`),
  };
}

describe('proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the page the same nonce the response policy allows', () => {
    const { policy, nonce, forwardedNonce, forwardedPolicy } = run('/en/auth/login');

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{48}$/);
    expect(forwardedNonce).toBe(nonce);
    expect(forwardedPolicy).toBe(policy);
  });

  it('makes a new nonce for every request', () => {
    const first = run('/en/auth/login');
    const second = run('/en/auth/login');

    expect(first.nonce).toBeDefined();
    expect(second.nonce).not.toBe(first.nonce);
    expect(second.forwardedNonce).toBe(second.nonce);
  });

  it('overwrites a nonce or policy the client sent', () => {
    const { nonce, forwardedNonce, forwardedPolicy, policy } = run('/en/auth/login', {
      'x-nonce': 'chosen-by-the-client',
      'content-security-policy': "script-src 'unsafe-inline'",
    });

    expect(forwardedNonce).toBe(nonce);
    expect(forwardedNonce).not.toBe('chosen-by-the-client');
    expect(forwardedPolicy).toBe(policy);
  });

  it('allows no inline script in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { policy, nonce } = run('/en/auth/login');

    expect(policy.split('; ')).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  });

  it('allows eval beside the nonce in development only', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { policy, nonce } = run('/en/auth/login');

    expect(policy.split('; ')).toContain(
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`,
    );
  });

  it('keeps the locale redirect and puts the policy on it', () => {
    const { response, nonce } = run('/');

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/en');
    expect(nonce).toBeDefined();
  });

  it('sends the policy on a path the locale routing does not own, without redirecting it', () => {
    const { response, nonce, forwardedNonce } = run('/missing.file');

    expect(response.headers.get('location')).toBeNull();
    expect(nonce).toBeDefined();
    expect(forwardedNonce).toBe(nonce);
  });

  // Which of the two senders answers each path: the proxy with its nonce
  // policy, or the fixed policy the Next configuration sends where the proxy
  // does not run. Next sends its own on image optimization.
  it.each([
    ['/en/auth/login', true, false],
    ['/', true, false],
    ['/missing.file', true, false],
    ['/_next/static/chunks/main.js', false, true],
    ['/api/health', false, true],
    ['/favicon.ico', false, true],
    ['/_next/image', false, false],
  ])('%s: proxy %s, fixed policy %s', (path, proxied, fixed) => {
    const fixedSource = /^\/:path\((.*)\)$/.exec(UNPROXIED_SOURCE)?.[1];

    expect(new RegExp(`^${config.matcher}$`).test(path)).toBe(proxied);
    expect(new RegExp(`^/${fixedSource}$`).test(path)).toBe(fixed);
  });
});
