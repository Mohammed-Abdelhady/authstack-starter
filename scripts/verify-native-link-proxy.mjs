import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { renderNativeLinkHost } from '../nginx/render-native-link-host.mjs';
import { configureNginxDomains } from './lib/config-transforms.js';
import { command } from './lib/docker-command.mjs';
import { verifyNativeLinkProxy } from './lib/native-link-proxy-probes.mjs';
import {
  DEFAULT_PROXY_MANIFEST,
  ALTERNATE_PROXY_MANIFEST,
  certbotFixturePaths,
  writeCertbotFixture,
} from './lib/native-link-proxy-fixtures.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LINK_HOST = DEFAULT_PROXY_MANIFEST.host;
const API_HOST = 'api.proxy.test';
const CASES = [
  { name: 'link host enabled', manifest: DEFAULT_PROXY_MANIFEST, active: true },
  { name: 'alternate metadata', manifest: ALTERNATE_PROXY_MANIFEST, active: true },
  { name: 'link host absent', manifest: DEFAULT_PROXY_MANIFEST, active: false },
];
const IMAGE = process.argv[2] ?? 'native-link-proxy-gate:local';
const PROJECT = `link-proxy-${randomUUID().slice(0, 8)}`;
const directory = await mkdtemp(join(tmpdir(), 'native-link-proxy-'));
const compose = join(directory, 'compose.json');
const stop = new AbortController();
let composeWritten = false;
let failure;
const cleanupErrors = [];
const certbot = certbotFixturePaths(CASES.map(({ manifest }) => manifest));
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

function docker(args, options = {}) {
  return command('docker', args, { signal: stop.signal, ...options });
}

async function composeCommand(args, options = {}) {
  return docker(['compose', '-p', PROJECT, '-f', compose, ...args], options);
}

try {
  assert.equal(
    renderNativeLinkHost({
      ...DEFAULT_PROXY_MANIFEST,
      host: undefined,
      paths: [],
    }),
    '',
  );
  await writeCertbotFixture(directory, certbot);
  await mkdir(join(directory, 'ssl'));
  await mkdir(join(directory, 'native-link-host'));
  await chmod(join(directory, 'ssl'), 0o755);
  await chmod(join(directory, 'native-link-host'), 0o755);
  await command(
    'openssl',
    [
      'req',
      '-x509',
      '-nodes',
      '-days',
      '1',
      '-newkey',
      'rsa:2048',
      '-keyout',
      join(directory, 'ssl', 'privkey.pem'),
      '-out',
      join(directory, 'ssl', 'fullchain.pem'),
      '-subj',
      `/CN=${LINK_HOST}`,
    ],
    { signal: stop.signal },
  );
  // nginx runs unprivileged; these keys exist only for this isolated fixture.
  await chmod(join(directory, 'ssl', 'privkey.pem'), 0o644);
  await command('cp', [
    join(directory, 'ssl', 'fullchain.pem'),
    join(directory, 'ssl', 'chain.pem'),
  ]);
  await chmod(join(directory, 'ssl', 'fullchain.pem'), 0o644);
  await chmod(join(directory, 'ssl', 'chain.pem'), 0o644);
  const fixture = {
    services: {
      upstream: {
        image: 'node:22-alpine',
        environment: { GATE_MANIFEST: JSON.stringify(DEFAULT_PROXY_MANIFEST) },
        command: ['node', '/fixture/upstream.mjs'],
        ports: ['127.0.0.1::5000'],
        volumes: [`${join(ROOT, 'nginx/proxy-gate-upstream.mjs')}:/fixture/upstream.mjs:ro`],
        networks: { default: { aliases: ['backend', 'frontend'] } },
        healthcheck: {
          test: [
            'CMD',
            'node',
            '-e',
            "fetch('http://127.0.0.1:5000/health').then(r=>{if(!r.ok)process.exit(1)})",
          ],
          interval: '1s',
          timeout: '3s',
          retries: 10,
        },
      },
      edge: {
        image: IMAGE,
        ports: ['127.0.0.1::8080', '127.0.0.1::8443'],
        depends_on: { upstream: { condition: 'service_healthy' } },
        volumes: [
          `${join(directory, 'nginx.conf')}:/etc/nginx/nginx.conf:ro`,
          `${join(directory, 'ssl')}:/etc/nginx/ssl:ro`,
          `${join(directory, 'certbot')}:/var/www/certbot:ro`,
          `${join(directory, 'native-link-host')}:/etc/nginx/native-link-host:ro`,
        ],
        healthcheck: {
          test: [
            'CMD',
            'wget',
            '-q',
            '--no-check-certificate',
            '--spider',
            '--header=Host: api.proxy.test',
            'https://127.0.0.1:8443/health',
          ],
          interval: '1s',
          timeout: '3s',
          retries: 10,
        },
      },
    },
  };
  await writeFile(compose, JSON.stringify(fixture));
  composeWritten = true;
  for (const file of ['nginx.conf', 'production-nginx.conf']) {
    const original = await readFile(join(ROOT, 'nginx', file), 'utf8');
    const configured = configureNginxDomains(original, {
      mainDomain: 'app.proxy.test',
      frontendDomain: 'app.proxy.test',
      backendDomain: API_HOST,
    });
    await writeFile(join(directory, 'nginx.conf'), configured);
    await chmod(join(directory, 'nginx.conf'), 0o644);
    for (const { name, manifest, active } of CASES) {
      fixture.services.upstream.environment.GATE_MANIFEST = JSON.stringify(manifest);
      await writeFile(compose, JSON.stringify(fixture));
      await writeFile(
        join(directory, 'native-link-host', 'link-host.conf'),
        renderNativeLinkHost(active ? manifest : { ...manifest, host: undefined, paths: [] }),
      );
      await chmod(join(directory, 'native-link-host', 'link-host.conf'), 0o644);
      await composeCommand(['up', '-d', '--wait', '--wait-timeout', '60'], {
        timeout: 90_000,
      });
      await composeCommand(['exec', '-T', 'edge', 'nginx', '-t']);
      const httpPort = Number((await composeCommand(['port', 'edge', '8080'])).split(':').at(-1));
      const httpsPort = Number((await composeCommand(['port', 'edge', '8443'])).split(':').at(-1));
      const statsPort = Number(
        (await composeCommand(['port', 'upstream', '5000'])).split(':').at(-1),
      );
      await verifyNativeLinkProxy({
        httpPort,
        httpsPort,
        statsPort,
        active,
        signal: stop.signal,
        manifest,
        unexpectedPaths: DEFAULT_PROXY_MANIFEST.associationPaths.filter(
          (path) => !manifest.associationPaths.includes(path),
        ),
        apiHost: API_HOST,
      });
      console.log(`${file}: ${name} routing verified`);
      await composeCommand(['down', '--remove-orphans']);
    }
  }
} catch (error) {
  failure = error;
} finally {
  if (composeWritten) {
    await command('docker', [
      'compose',
      '-p',
      PROJECT,
      '-f',
      compose,
      'down',
      '--remove-orphans',
    ]).catch((error) => cleanupErrors.push(error));
  }
  for (const file of [
    'ssl/privkey.pem',
    'ssl/fullchain.pem',
    'ssl/chain.pem',
    'native-link-host/link-host.conf',
    'nginx.conf',
    'compose.json',
    ...certbot.files,
  ]) {
    await unlink(join(directory, file)).catch((error) => {
      if (error.code !== 'ENOENT') cleanupErrors.push(error);
    });
  }
  for (const child of [...certbot.directories, 'ssl', 'native-link-host', '']) {
    await rmdir(join(directory, child)).catch((error) => {
      if (error.code !== 'ENOENT') cleanupErrors.push(error);
    });
  }
}
if (failure || cleanupErrors.length) {
  throw new AggregateError(
    [...(failure ? [failure] : []), ...cleanupErrors],
    'Native link proxy gate or cleanup failed',
  );
}
