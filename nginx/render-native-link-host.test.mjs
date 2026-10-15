import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderNativeLinkHost } from './render-native-link-host.mjs';
import {
  ALTERNATE_PROXY_MANIFEST,
  DEFAULT_PROXY_MANIFEST,
} from '../scripts/lib/native-link-proxy-fixtures.mjs';

// Failure: an old producer omits boundary metadata and nginx silently invents policy.
test('requires complete producer metadata, including when the host is absent', () => {
  for (const field of [
    'apiPrefix',
    'acmeChallengePrefix',
    'reservedPathPrefixes',
    'associationPaths',
  ]) {
    const missing = { ...DEFAULT_PROXY_MANIFEST };
    delete missing[field];
    assert.throws(() => renderNativeLinkHost(missing));
    assert.throws(() => renderNativeLinkHost({ ...missing, host: undefined, paths: [] }));
    assert.throws(() => renderNativeLinkHost({ ...DEFAULT_PROXY_MANIFEST, [field]: null }));
  }
  assert.equal(
    renderNativeLinkHost({
      ...DEFAULT_PROXY_MANIFEST,
      host: undefined,
      paths: [],
    }),
    '',
  );
});

// Failure: metadata disagrees about a reserved namespace and broadens the proxy boundary.
test('refuses inconsistent API or ACME metadata and reserved exact paths', () => {
  assert.throws(() => renderNativeLinkHost({ ...DEFAULT_PROXY_MANIFEST, apiPrefix: 'service' }));
  assert.throws(() =>
    renderNativeLinkHost({
      ...DEFAULT_PROXY_MANIFEST,
      acmeChallengePrefix: '/other-challenge/',
    }),
  );
  for (const path of [
    '/service/auth/identity',
    '/blocked/token',
    '/.well-known/acme-challenge/token',
  ]) {
    assert.throws(() => renderNativeLinkHost({ ...ALTERNATE_PROXY_MANIFEST, paths: [path] }));
  }
});

// Failure: path aliases or injected values add locations outside the effective allowlist.
test('refuses unsafe paths and hosts without rejecting safe literal paths', () => {
  for (const path of ['https://elsewhere.test/', '/native/../api', '/%2fapi', '/literal\\$token']) {
    assert.throws(() => renderNativeLinkHost({ ...DEFAULT_PROXY_MANIFEST, paths: [path] }));
  }
  for (const host of ['*.proxy.test', 'links.proxy.test;return 200']) {
    assert.throws(() => renderNativeLinkHost({ ...DEFAULT_PROXY_MANIFEST, host }));
  }
  assert.doesNotThrow(() =>
    renderNativeLinkHost({
      ...ALTERNATE_PROXY_MANIFEST,
      paths: ['/api/return', '/docs/return', '/literal$token', '/مخصص/تفعيل'],
    }),
  );
});
