import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { ACME_TOKEN_BODY, ACME_TOKEN_NAME } from './native-link-proxy-fixtures.mjs';

function requestToProxy(signal, port, tls, host, path, headers = {}, method = 'GET') {
  return new Promise((resolveResponse, reject) => {
    const send = tls ? httpsRequest : httpRequest;
    const outgoing = send(
      {
        hostname: '127.0.0.1',
        port,
        path: encodeURI(path),
        method,
        headers: { Host: host, ...headers },
        servername: host,
        // A new local certificate is used only by this fixture.
        rejectUnauthorized: false,
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('error', reject);
        response.on('end', () =>
          resolveResponse({
            status: response.statusCode,
            headers: response.headers,
            body,
          }),
        );
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

export async function verifyNativeLinkProxy({
  httpPort,
  httpsPort,
  statsPort,
  active,
  signal,
  manifest,
  apiHost,
  unexpectedPaths = [],
}) {
  const LINK_HOST = manifest.host;
  const API_HOST = apiHost;
  const MANIFEST = manifest;
  const request = (...args) => requestToProxy(signal, ...args);
  const stats = async () =>
    JSON.parse((await request(statsPort, false, API_HOST, '/gate/stats')).body);
  for (const [port, tls] of [
    [httpPort, false],
    [httpsPort, true],
  ]) {
    if (!active) {
      const ordinary = await request(port, tls, 'app.proxy.test', '/');
      assert.equal(ordinary.status, tls ? 200 : 301);
      if (tls) {
        const absent = await request(port, tls, LINK_HOST, MANIFEST.associationPaths[0]);
        assert.equal(absent.status, 200);
        assert.equal(absent.body, 'synthetic frontend reached');
      }
      continue;
    }
    for (const path of [...MANIFEST.associationPaths, ...MANIFEST.paths]) {
      const response = await request(port, tls, LINK_HOST, `${path}?ignored=yes`, {
        'X-Forwarded-Host': API_HOST,
        'X-Forwarded-Proto': 'forged',
        'X-Forwarded-Port': '9',
        'X-Forwarded-For': '203.0.113.9',
        'X-Real-IP': '203.0.113.9',
        Forwarded: `host=${API_HOST};proto=forged`,
      });
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.location, undefined, path);
      assert.equal(response.headers['x-gate-upstream'], 'backend');
      assert.equal(response.headers['x-gate-host'], LINK_HOST);
      assert.equal(response.headers['x-gate-forwarded-host'], LINK_HOST);
      assert.equal(response.headers['x-gate-forwarded-proto'], tls ? 'https' : 'http');
      assert.equal(response.headers['x-gate-forwarded-port'], tls ? '8443' : '8080');
      assert.notEqual(response.headers['x-gate-forwarded-for'], '203.0.113.9');
      assert.equal(response.headers['x-gate-real-ip'], response.headers['x-gate-forwarded-for']);
      assert.equal(response.headers['x-gate-forwarded'], '');
      assert.match(
        response.headers['content-type'],
        MANIFEST.associationPaths.includes(path) ? /^application\/json/u : /^text\/html/u,
      );
    }
    const challengePath = `${MANIFEST.acmeChallengePrefix}${ACME_TOKEN_NAME}`;
    const beforeChallenge = await stats();
    const challenge = await request(port, tls, LINK_HOST, challengePath);
    assert.equal(challenge.status, tls ? 404 : 200);
    if (!tls) {
      assert.equal(challenge.body, ACME_TOKEN_BODY);
      assert.match(challenge.headers['content-type'], /^text\/plain/u);
      const missing = await request(port, tls, LINK_HOST, `${challengePath}-missing`);
      assert.equal(missing.status, 404);
    }
    assert.deepEqual(await stats(), beforeChallenge, 'ACME reached an upstream');
    for (const path of [
      `/${MANIFEST.apiPrefix}/auth/identity`,
      ...MANIFEST.reservedPathPrefixes.map((prefix) => `${prefix}/gate-denied`),
      '/native/return/extra',
      '/literal\\$token',
      '/other',
      ...unexpectedPaths,
    ]) {
      const before = await stats();
      const denied = await request(port, tls, LINK_HOST, path, {
        'X-Forwarded-Host': API_HOST,
      });
      assert.equal(denied.status, 404, path);
      assert.deepEqual(await stats(), before, `${path} reached an upstream`);
    }
    const before = await stats();
    const wrongMethod = await request(port, tls, LINK_HOST, MANIFEST.paths[0], {}, 'POST');
    assert.equal(wrongMethod.status, 405);
    assert.deepEqual(await stats(), before);
  }
  for (const path of MANIFEST.associationPaths) {
    const forged = await request(httpsPort, true, API_HOST, path, {
      'X-Forwarded-Host': LINK_HOST,
    });
    assert.equal(forged.status, 404);
  }
}
