import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const ACME_TOKEN_NAME = 'proxy-gate-token';
export const ACME_TOKEN_BODY = 'synthetic-http01-token';

// Handwritten protocol fixtures stay independent of the backend producer.
export const DEFAULT_PROXY_MANIFEST = {
  host: 'links.proxy.test',
  paths: ['/custom/ar/activate', '/native/return', '/مخصص/تفعيل', '/literal$token'],
  apiPrefix: 'api',
  acmeChallengePrefix: '/.well-known/acme-challenge/',
  reservedPathPrefixes: [
    '/api',
    '/health',
    '/docs',
    '/api-docs',
    '/swagger',
    '/assets',
    '/_next',
    '/static',
    '/.well-known/acme-challenge',
  ],
  associationPaths: ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'],
};

export const ALTERNATE_PROXY_MANIFEST = {
  host: 'links.proxy.test',
  paths: ['/api/return', '/docs/return', '/native/return', '/literal$token'],
  apiPrefix: 'service',
  acmeChallengePrefix: '/.well-known/acme-challenge/',
  reservedPathPrefixes: ['/service', '/blocked', '/.well-known/acme-challenge'],
  associationPaths: ['/.well-known/alternate-association.json'],
};

export function certbotFixturePaths(manifests) {
  const directories = new Set(['certbot']);
  const files = new Set();
  for (const manifest of manifests) {
    let parent = 'certbot';
    for (const segment of manifest.acmeChallengePrefix.split('/').filter(Boolean)) {
      parent = join(parent, segment);
      directories.add(parent);
    }
    files.add(join(parent, ACME_TOKEN_NAME));
  }
  return {
    files: [...files],
    directories: [...directories].reverse(),
  };
}

export async function writeCertbotFixture(directory, fixture) {
  for (const path of [...fixture.directories].reverse()) {
    await mkdir(join(directory, path), { recursive: true });
    await chmod(join(directory, path), 0o755);
  }
  for (const path of fixture.files) {
    await writeFile(join(directory, path), ACME_TOKEN_BODY);
    await chmod(join(directory, path), 0o644);
  }
}
