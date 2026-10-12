import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../../next.config';

const CSP = 'Content-Security-Policy';

async function configuredHeaders() {
  const rules = (await nextConfig.headers?.()) ?? [];
  return rules.map((rule) => ({
    source: rule.source,
    keys: rule.headers.map((header) => header.key),
    policy: rule.headers.find((header) => header.key === CSP)?.value,
  }));
}

describe('headers the Next configuration sends', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the fixed headers on every path and leaves the policy to the proxy there', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const everyPath = (await configuredHeaders()).find((rule) => rule.source === '/:path*');

    expect(everyPath?.keys).toEqual([
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'X-Frame-Options',
      'Strict-Transport-Security',
    ]);
  });

  it('sends one policy that loads nothing where the proxy does not run', async () => {
    const withPolicy = (await configuredHeaders()).filter((rule) => rule.policy !== undefined);

    expect(withPolicy).toEqual([
      {
        source: '/:path((?:api|_next/static|favicon\\.ico).*)',
        keys: [CSP],
        policy: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      },
    ]);
  });
});
