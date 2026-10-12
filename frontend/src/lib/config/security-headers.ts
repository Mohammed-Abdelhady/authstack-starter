export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeadersOptions {
  isProduction?: boolean;
}

export function extractOrigin(rawUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('/')) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
    return null;
  } catch {
    return null;
  }
}

export const CONTENT_SECURITY_POLICY_HEADER = 'Content-Security-Policy';
/** Request header the proxy uses to hand the nonce to server components. */
export const NONCE_HEADER = 'x-nonce';

export interface ContentSecurityPolicyOptions {
  /** Fresh for every request. Next reads it back from the policy while rendering. */
  nonce: string;
  apiUrl?: string;
  isDevelopment?: boolean;
}

export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

export function buildContentSecurityPolicy({
  nonce,
  apiUrl,
  isDevelopment = false,
}: ContentSecurityPolicyOptions): string {
  const origin = extractOrigin(apiUrl);
  const withApi = origin ? `'self' ${origin}` : "'self'";
  // React's development build rebuilds call stacks with eval().
  const scriptSrc = `'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`;

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // The toast and dialog libraries add style elements at run time and Radix
    // renders style attributes, none of which can carry the nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${withApi}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action ${withApi}`,
    "object-src 'none'",
  ];

  return directives.join('; ');
}

/**
 * Paths the proxy leaves alone: static files, image optimization and API
 * routes. Keep it the complement of the matcher in `src/proxy.ts`. Image
 * optimization is left out because Next sends its own policy there.
 */
export const UNPROXIED_SOURCE = '/:path((?:api|_next/static|favicon\\.ico).*)';

/**
 * Sent on those paths. A file needs no policy, so this only matters when a
 * document is answered there, and then it may load nothing.
 */
export const UNPROXIED_CONTENT_SECURITY_POLICY =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/**
 * The headers that are the same for every response. The content security
 * policy is not among them: it carries a nonce, so the proxy sends it.
 */
export function buildSecurityHeaders(options: SecurityHeadersOptions = {}): SecurityHeader[] {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';

  const headers: SecurityHeader[] = [
    {
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    },
    {
      key: 'X-Frame-Options',
      value: 'DENY',
    },
  ];

  if (isProduction) {
    headers.push({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    });
  }

  return headers;
}
