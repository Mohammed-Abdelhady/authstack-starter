import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runHttpProbes,
  httpProbeProgram,
  validateProbeResults,
} from '../lib/docker-http-probes.mjs';
import { command } from '../verify-docker.mjs';
function probeResponse(url) {
  if (url === 'http://backend:5000/health') {
    return new Response(JSON.stringify({ status: 'healthy', timestamp: '2026-09-08T00:00:00Z' }));
  }
  if (url === 'http://nginx:8080/health') return new Response('{"status":"healthy"}');
  if (url.startsWith('http://frontend:3000/')) {
    const locale = url.match(/frontend:3000\/([a-z]{2})\//)?.[1] ?? 'en';
    const direction = locale === 'en' ? 'ltr' : 'rtl';
    return new Response(`<!DOCTYPE html><html lang="${locale}" dir="${direction}"><body>
      <div role="status" aria-busy="true" aria-live="polite" data-testid="store-rehydration-loading"></div>
      <script src="/_next/static/chunks/app.js" async></script>
      <script>self.__next_f.push([1,"bootstrap"])</script></body></html>`);
  }
  if (url === 'http://backend:5000/api/auth/methods') {
    return new Response('{"data":{"methods":{"password":true,"oauth":[]}}}');
  }
  throw new Error('unexpected probe target');
}

test('fixed service DNS probes preserve every HTTP contract without exposing bodies', async () => {
  const urls = [];
  const result = await runHttpProbes(async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    return probeResponse(url);
  });
  assert.deepEqual(urls, [
    'http://backend:5000/health',
    'http://nginx:8080/health',
    'http://frontend:3000/en/auth/login',
    'http://frontend:3000/ar/auth/login', // feature:locale-ar
    'http://backend:5000/api/auth/methods',
  ]);
  validateProbeResults(JSON.stringify(result));
  assert.deepEqual(Object.keys(result), ['checked']);
  const output = await command(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `globalThis.fetch = ${probeResponse.toString()}; ${httpProbeProgram()}`,
    ],
    { env: {}, timeout: 5000 },
  );
  validateProbeResults(output);
});

for (const [name, response, reason] of [
  [
    'non200',
    () => new Response('private detail', { status: 503 }),
    'unexpected HTTP status or redirect',
  ],
  [
    'redirect',
    () => new Response('', { status: 302, headers: { location: '/other' } }),
    'unexpected HTTP status or redirect',
  ],
  [
    '200 redirect header',
    () => new Response('{}', { headers: { location: '/other' } }),
    'unexpected HTTP status or redirect',
  ],
  ['malformed JSON', () => new Response('private detail'), 'invalid JSON'],
  [
    'invalid health',
    () => new Response('{"status":"healthy","timestamp":"invalid"}'),
    'health response contract',
  ],
  ['null health', () => new Response('null'), 'health response contract'],
  ['oversize', () => new Response('x'.repeat(129)), 'response too large'],
]) {
  test(`HTTP probe rejects ${name} with bounded named diagnostics`, async () => {
    const result = await runHttpProbes(response, 1000, 128);
    assert.deepEqual(result, { failure: 'backend-health', reason });
    assert.throws(() => validateProbeResults(JSON.stringify(result)), /backend-health/);
    assert.ok(!JSON.stringify(result).includes('private detail'));
  });
}

for (const [name, suffix, body] of [
  ['nginx shape', ':8080/health', '{"status":"healthy","extra":true}'],
  ['English document', '/en/auth/login', '<html lang="fr"><form>'],
  ['Arabic shell', '/ar/auth/login', '<html lang="ar">'], // feature:locale-ar
  [
    'enabled external method',
    '/api/auth/methods',
    '{"data":{"methods":{"password":true,"magicLink":true}}}',
  ],
  ['missing password', '/api/auth/methods', '{"data":{"methods":{"oauth":[]}}}'],
  [
    'unexpected OAuth provider',
    '/api/auth/methods',
    '{"data":{"methods":{"password":true,"oauth":["external"]}}}',
  ],
]) {
  test(`HTTP probe rejects ${name} without dropping earlier checks`, async () => {
    const result = await runHttpProbes(async (url) =>
      url.endsWith(suffix) ? new Response(body) : probeResponse(url),
    );
    assert.ok(result.failure);
    assert.throws(() => validateProbeResults(JSON.stringify(result)), /contract/);
  });
}

for (const locale of [
  'en',
  'ar', // feature:locale-ar
]) {
  for (const [name, mutate] of [
    ['blank document', () => ''],
    ['error document', () => '<html><body>Application error</body></html>'],
    [
      'missing script asset',
      (html) => html.replace('/_next/static/chunks/app.js', '/unrelated.js'),
    ],
    ['missing bootstrap', (html) => html.replace('self.__next_f.push', 'unrelated')],
    ['Next error document', (html) => html.replace('<html ', '<html id="__next_error__" ')],
  ]) {
    test(`SSR probe rejects ${locale} ${name}`, async () => {
      const url = `http://frontend:3000/${locale}/auth/login`;
      const html = await probeResponse(url).text();
      const result = await runHttpProbes((target) =>
        target === url ? new Response(mutate(html)) : probeResponse(target),
      );
      assert.deepEqual(result, {
        failure: `frontend-${locale}`,
        reason: 'login document contract',
      });
    });
  }
}

test('request failures and timeouts retain only sanitized reasons', async () => {
  assert.deepEqual(
    await runHttpProbes(() => {
      throw new Error('private details');
    }),
    {
      failure: 'backend-health',
      reason: 'request failed',
    },
  );
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await runHttpProbes(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
      20,
    );
    assert.deepEqual(result, { failure: 'backend-health', reason: 'request timed out' });
  } finally {
    clearTimeout(keepAlive);
  }
});

test('otherwise-valid HTTP200 with an empty Location header is rejected', async () => {
  const result = await runHttpProbes(async (url) => {
    const response = probeResponse(url);
    response.headers.set('location', '');
    return response;
  });
  assert.deepEqual(result, {
    failure: 'backend-health',
    reason: 'unexpected HTTP status or redirect',
  });
});

test('result parser rejects incomplete, malformed and unknown diagnostic payloads', () => {
  for (const output of [
    '',
    'null',
    '{}',
    '{"checked":[]}',
    '{"failure":"private","reason":"private"}',
  ]) {
    assert.throws(() => validateProbeResults(output), /result/);
  }
});

test('probe command preserves nonzero, timeout, cancellation and bounded output handling', async () => {
  const options = { env: {}, timeout: 1000 };
  await assert.rejects(
    command(process.execPath, ['-e', 'process.exit(3)'], { ...options, label: 'probe' }),
    /probe: .* exited 3/,
  );
  await assert.rejects(
    command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      ...options,
      timeout: 30,
    }),
    /timed out/,
  );
  await assert.rejects(
    command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      ...options,
      signal: AbortSignal.timeout(30),
    }),
    /cancelled/,
  );
  await assert.rejects(
    command(process.execPath, ['-e', 'process.stdout.write("x".repeat(1048577))'], options),
    /output limit/,
  );
});
