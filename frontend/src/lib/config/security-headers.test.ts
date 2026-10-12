import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  createNonce,
  extractOrigin,
} from './security-headers';

// Written out by hand, with a fixed nonce in place of the one made per request.
const NONCE = 'bm9uY2UtZm9yLXRlc3Rz';
const PRODUCTION_CSP_SAME_ORIGIN =
  "default-src 'self'; script-src 'self' 'nonce-bm9uY2UtZm9yLXRlc3Rz' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const PRODUCTION_CSP_WITH_API =
  "default-src 'self'; script-src 'self' 'nonce-bm9uY2UtZm9yLXRlc3Rz' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.example.com; object-src 'none'";
const DEVELOPMENT_CSP_WITH_API =
  "default-src 'self'; script-src 'self' 'nonce-bm9uY2UtZm9yLXRlc3Rz' 'strict-dynamic' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://api.example.com; object-src 'none'";

/** The sources one directive of a policy allows. */
function sourcesOf(policy: string, directive: string): string[] {
  const entry = policy.split('; ').find((part) => part.startsWith(`${directive} `));
  return entry ? entry.split(' ').slice(1) : [];
}

describe('security-headers', () => {
  describe('extractOrigin', () => {
    it('extracts origin from full http url', () => {
      expect(extractOrigin('http://localhost:5000')).toBe('http://localhost:5000');
    });

    it('extracts origin from full https url with path and query', () => {
      expect(extractOrigin('https://api.example.com:8443/v1/auth?client=web')).toBe(
        'https://api.example.com:8443',
      );
    });

    it('returns null for relative urls', () => {
      expect(extractOrigin('/api/v1')).toBeNull();
    });

    it('returns null for empty or undefined input', () => {
      expect(extractOrigin(undefined)).toBeNull();
      expect(extractOrigin('')).toBeNull();
      expect(extractOrigin('   ')).toBeNull();
    });

    it('returns null for invalid protocols and malformed strings', () => {
      expect(extractOrigin('javascript:alert(1)')).toBeNull();
      expect(extractOrigin('not-a-valid-url')).toBeNull();
    });
  });

  describe('buildContentSecurityPolicy', () => {
    const API_URL = 'https://api.example.com/v1';

    it('sends the production policy when no api origin is set', () => {
      expect(buildContentSecurityPolicy({ nonce: NONCE })).toBe(PRODUCTION_CSP_SAME_ORIGIN);
    });

    it('adds the api origin to connect-src and form-action', () => {
      expect(buildContentSecurityPolicy({ nonce: NONCE, apiUrl: API_URL })).toBe(
        PRODUCTION_CSP_WITH_API,
      );
    });

    it('keeps eval out when development is explicitly off', () => {
      expect(
        buildContentSecurityPolicy({ nonce: NONCE, apiUrl: API_URL, isDevelopment: false }),
      ).toBe(PRODUCTION_CSP_WITH_API);
    });

    it('allows eval in script-src only, and only in development', () => {
      expect(
        buildContentSecurityPolicy({ nonce: NONCE, apiUrl: API_URL, isDevelopment: true }),
      ).toBe(DEVELOPMENT_CSP_WITH_API);
    });

    it.each([
      ['production', false],
      ['development', true],
    ])('never allows inline scripts in %s', (_name, isDevelopment) => {
      const policy = buildContentSecurityPolicy({ nonce: NONCE, apiUrl: API_URL, isDevelopment });

      expect(sourcesOf(policy, 'script-src')).not.toContain("'unsafe-inline'");
      expect(sourcesOf(policy, 'default-src')).not.toContain("'unsafe-inline'");
    });

    it('ignores an api address that is not an http origin', () => {
      expect(buildContentSecurityPolicy({ nonce: NONCE, apiUrl: 'javascript:alert(1)' })).toBe(
        PRODUCTION_CSP_SAME_ORIGIN,
      );
    });
  });

  describe('createNonce', () => {
    it('makes a different base64 value on every call', () => {
      const first = createNonce();
      const second = createNonce();

      expect(first).toMatch(/^[A-Za-z0-9+/]{48}$/);
      expect(second).not.toBe(first);
    });
  });

  describe('buildSecurityHeaders', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns the fixed headers outside production, with no transport security', () => {
      expect(buildSecurityHeaders({ isProduction: false })).toEqual([
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ]);
    });

    it('adds strict-transport-security in production', () => {
      expect(buildSecurityHeaders({ isProduction: true })).toEqual([
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      ]);
    });

    it('follows NODE_ENV when the caller does not say', () => {
      vi.stubEnv('NODE_ENV', 'production');

      expect(buildSecurityHeaders().map((header) => header.key)).toContain(
        'Strict-Transport-Security',
      );
    });

    it('leaves the content security policy to the proxy', () => {
      vi.stubEnv('NODE_ENV', 'production');

      expect(buildSecurityHeaders().map((header) => header.key)).not.toContain(
        'Content-Security-Policy',
      );
    });
  });
});
