import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  configureBackendPort,
  configureFrontendPort,
  configureNginxDomains,
} from '../lib/config-transforms.js';
import { configureDatabase } from '../lib/production-prompts.js';
import { smokeModel } from '../verify-docker.mjs';

const domains = {
  mainDomain: 'example.test',
  frontendDomain: 'www.example.test',
  backendDomain: 'api.example.test',
};

// The backend runs with `trust proxy = 1` and rate limits on req.ip, so the edge
// must declare X-Forwarded-For instead of extending whatever the client sent.
function assertDeclaredForwardedFor(config) {
  const directives = [...config.matchAll(/proxy_set_header X-Forwarded-For (\S+);/g)].map(
    (match) => match[1],
  );
  assert.ok(directives.length >= 4, `${directives.length} forwarding directives`);
  assert.deepEqual([...new Set(directives)], ['$remote_addr']);
}

for (const file of ['nginx/nginx.conf', 'nginx/production-nginx.conf']) {
  test(`${file}: current and repeated domain setup`, async () => {
    const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /proxy_add_x_forwarded_for/);
    assertDeclaredForwardedFor(source);
    const result = configureNginxDomains(source, domains);
    assert.match(result, /server_name example\.test www\.example\.test;/);
    assert.match(result, /server_name api\.example\.test;/);
    assertDeclaredForwardedFor(result);
    assert.equal((result.match(/listen 8443 ssl;/g) || []).length, 2);
    assert.equal((result.match(/listen \[::\]:8443 ssl;/g) || []).length, 2);
    assert.doesNotMatch(result, /listen (?:\[::\]:)?443\b|backend\/api\/health/);
    assert.match(result, /proxy_pass http:\/\/backend\/health;/);
    assert.equal(configureNginxDomains(result, domains), result);
    const changed = configureNginxDomains(result, {
      mainDomain: 'new.test',
      frontendDomain: 'new.test',
      backendDomain: 'api.new.test',
    });
    assert.equal((changed.match(/# API server/g) || []).length, 1);
    assert.match(changed, /server_name new\.test;/);
    assert.doesNotMatch(changed, /example\.test/);
    assertDeclaredForwardedFor(changed);
  });
}
for (const port of [5001, 5507, 1, 65535]) {
  test(`docker-compose.prod.yml: backend port ${port} preserves frontend listener`, async () => {
    const source = await readFile(new URL('../../docker-compose.prod.yml', import.meta.url), 'utf8');
    const result = configureBackendPort(source, port);
    const [backend, frontend] = result.split('  backend:\n')[1].split('  frontend:\n');
    assert.match(backend, new RegExp(`PORT: ${port}\\b`));
    assert.ok(backend.includes(`http://localhost:${port}/health`));
    assert.ok(backend.includes(`- '${port}'`));
    assert.match(frontend, /PORT: 3000\b/);
    assert.equal(configureBackendPort(result, port), result);
    assert.ok(configureBackendPort(result, 6011).includes('http://localhost:6011/health'));
  });
}

for (const port of [3000, 5300]) {
  test(`docker-compose.prod.yml: frontend host port ${port} keeps internal port 3000`, async () => {
    const source = await readFile(new URL('../../docker-compose.prod.yml', import.meta.url), 'utf8');
    const result = configureFrontendPort(configureBackendPort(source, 5507), port);
    const frontend = result.split('  frontend:\n')[1];
    assert.match(frontend, /expose:\s*\n\s*- '3000'/);
    assert.match(frontend, /PORT: 3000\b/);
    assert.match(frontend, /http:\/\/127\.0\.0\.1:3000\/en\/auth\/login/);
    assert.equal(configureFrontendPort(result, port), result);
    assert.ok(result.includes('http://localhost:5507/health'));
  });
}

test('invalid ports and unknown config structure fail before writing', () => {
  assert.throws(() => configureNginxDomains('', domains), /virtual host/);
});
test('smoke does not hide a missing or mismatched frontend PORT', () => {
  const model = {
    services: Object.fromEntries(
      ['mongodb', 'backend', 'frontend', 'nginx'].map((name) => [
        name,
        { healthcheck: { test: ['CMD', 'synthetic'] }, environment: {} },
      ]),
    ),
  };
  for (const port of [undefined, 5000]) {
    model.services.frontend.environment.PORT = port;
    assert.throws(() => smokeModel(model, '/synthetic'), /frontend PORT/);
  }
  model.services.frontend.environment.PORT = 3000;
  assert.equal(smokeModel(model, '/synthetic').services.frontend.environment.PORT, '3000');
});
test('manual startup commands exist in their workspaces', async () => {
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const manual = readme.split('### Start manually')[1].split('Endpoints:')[0];
  const commands = [...manual.matchAll(/pnpm --filter ([\w-]+) run ([\w:-]+)/g)];
  assert.equal(commands.length, 2);
  for (const [, workspace, script] of commands) {
    const manifest = JSON.parse(
      await readFile(new URL(`../../${workspace}/package.json`, import.meta.url), 'utf8'),
    );
    assert.equal(typeof manifest.scripts[script], 'string');
  }
});

test('architecture methods example satisfies the actual frontend response type', async () => {
  const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
  const ts = require('typescript');
  const document = await readFile(new URL('../../docs/reference/ARCHITECTURE.md', import.meta.url), 'utf8');
  const example = [...document.matchAll(/```json\n([\s\S]*?)```/g)].find((match) =>
    match[1].includes('"methods"'),
  )?.[1];
  const payload = example && JSON.parse(example);
  assert.ok(example, 'methods example exists');
  const filename = fileURLToPath(new URL('../../methods-documentation-contract.ts', import.meta.url));
  const authTypes = fileURLToPath(new URL('../../shared/sdk/src/types.js', import.meta.url));
  const options = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  function errors(value) {
    const source = `import type { AuthMethodsResponse } from ${JSON.stringify(authTypes)}; const example = ${JSON.stringify(value)}; example.data satisfies AuthMethodsResponse;`;
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (path, version, ...rest) =>
      path === filename
        ? ts.createSourceFile(path, source, version, true)
        : getSourceFile(path, version, ...rest);
    return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  }
  assert.deepEqual(
    errors(payload).map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')),
    [],
  );
  assert.ok(errors({ ...payload, data: { methods: { emailPassword: true } } }).length > 0);
});

test('internal smoke network has no incompatible host publications', () => {
  const original = {
    services: Object.fromEntries(
      ['mongodb', 'backend', 'frontend', 'nginx'].map((name) => [
        name,
        {
          healthcheck: { test: ['CMD', 'synthetic'] },
          environment: { PORT: '3000' },
        },
      ]),
    ),
  };
  const model = smokeModel(original, '/synthetic');
  assert.deepEqual(model.networks, { smoke: { internal: true } });
  for (const service of Object.values(model.services)) {
    assert.deepEqual(service.networks, ['smoke']);
    assert.equal(service.ports, undefined);
  }
});

test('the production prompt asks again until the database user and password fit the address', async () => {
  const answers = ['ad:min', 'app', 'p@ss/word', 'p%w', 'safe-Password_1', ''];
  const asked = [];
  const rl = {
    question: (prompt) => {
      asked.push(prompt);
      return Promise.resolve(answers.shift());
    },
  };

  const database = await configureDatabase(rl, 'my-app');

  assert.deepEqual(database, { username: 'app', password: 'safe-Password_1', dbName: 'my_app' });
  // Two questions for the user, three for the password, one for the name.
  assert.equal(asked.length, 6);
  assert.deepEqual(answers, []);
});
