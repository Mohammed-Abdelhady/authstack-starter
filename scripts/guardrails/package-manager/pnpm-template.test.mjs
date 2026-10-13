import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { legacyReferences } from '../../check-package-manager.mjs';
import { templateContent, isExcluded } from '../../../packages/create-authstack-starter/scripts/sync-template.mjs';
import { buildNextStepLines } from '../../lib/init-next-steps.js';
import { gitEnvironment } from '../git/git-environment.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('template sync preserves pnpm manifests, workspace edges and packed lock naming', () => {
  const root = JSON.parse(templateContent('package.json', readFileSync(join(ROOT, 'package.json'))));
  assert.equal(root.packageManager, 'pnpm@12.6.0');
  assert.deepEqual(root.engines, { node: '>=22.12.0 <23', pnpm: '12.6.0' });
  const mobileAuth = JSON.parse(
    templateContent('mobile/auth/package.json', readFileSync(join(ROOT, 'mobile/auth/package.json'))),
  );
  assert.deepEqual(
    {
      rootWorkspace: root.workspaces.includes('mobile/*'),
      workspaceFile: /^\s+-\s+mobile\/\*$/m.test(
        readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'),
      ),
      packageManager: mobileAuth.packageManager,
      engines: mobileAuth.engines,
      sdk: mobileAuth.dependencies['@app/sdk'],
      rootScripts: { lint: root.scripts.lint, typecheck: root.scripts.typecheck },
    },
    {
      rootWorkspace: true,
      workspaceFile: true,
      packageManager: 'pnpm@12.6.0',
      engines: { node: '>=22.12.0 <23', pnpm: '12.6.0' },
      sdk: 'workspace:*',
      rootScripts: {
        lint: 'pnpm -r --if-present run lint',
        typecheck: 'pnpm -r --if-present run typecheck',
      },
    },
  );
  assert.equal(root.scripts.build, 'pnpm -r --if-present run build');
  assert.equal(root.scripts.test, 'pnpm -r --workspace-concurrency=1 --if-present run test && pnpm run test:config');
  const frontend = JSON.parse(templateContent('frontend/package.json', readFileSync(join(ROOT, 'frontend/package.json'))));
  assert.equal(frontend.dependencies['@app/core'], 'workspace:*');
  assert.equal(frontend.dependencies['@app/sdk'], 'workspace:*');
  assert.equal(frontend.scripts.lint, 'pnpm run lint:rtl && eslint --max-warnings 0');
  assert.equal(isExcluded('pnpm-workspace.yaml', 'pnpm-workspace.yaml', false), false);
  assert.equal(isExcluded('pnpm-lock.yaml', 'pnpm-lock.yaml', false), false);
});

test('template sync preserves dependency-free config gates without excluded repository tests', () => {
  const root = JSON.parse(templateContent('package.json', readFileSync(join(ROOT, 'package.json'))));
  assert.match(root.scripts['test:config'], /scripts\/workspace-dependencies\.test\.mjs/);
  assert.doesNotMatch(root.scripts['test:config'], /pnpm-template\.test\.mjs/);
  assert.equal(
    isExcluded('scripts/guardrails/workspace/workspace-tool-fixture.mjs', 'workspace-tool-fixture.mjs', false),
    true,
  );
});

test('generated hooks and lint-staged commands remain runnable with pnpm', () => {
  for (const [hook, command] of [
    ['commit-msg', 'pnpm exec commitlint --edit "$1"'],
    ['pre-commit', 'pnpm exec lint-staged'],
    ['pre-push', 'pnpm run lint && pnpm run typecheck && pnpm run test'],
  ]) {
    const source = templateContent(`.husky/${hook}`, readFileSync(join(ROOT, '.husky', hook))).toString();
    assert.equal(source.split('\n').includes(command), true, hook);
    assert.equal(source.split('\n').includes('sh scripts/lib/require-package-manager.sh pnpm'), true, hook);
  }
  const staged = templateContent('.lintstagedrc.cjs', readFileSync(join(ROOT, '.lintstagedrc.cjs'))).toString();
  assert.match(staged, /pnpm --filter backend exec eslint --fix --max-warnings 0/);
  assert.doesNotMatch(staged, /\bnpm\b/);
});

test('repository and generated init commands select real workspace scripts', async () => {
  const config = { env: { frontendPort: 3000, backendPort: 5000 } };
  const commands = (lines) => lines
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter((line) => line.startsWith('pnpm ') || legacyReferences('generated-init.md', line).length > 0);
  assert.deepEqual(commands(buildNextStepLines(config)), [
    'pnpm install --frozen-lockfile', 'pnpm --filter backend run start:dev',
    'pnpm --filter frontend run dev', 'pnpm run setup:prod',
  ]);
  const source = templateContent('scripts/lib/init-next-steps.js', readFileSync(join(ROOT, 'scripts/lib/init-next-steps.js')))
    .toString().replace("'./cli-utils.js'", JSON.stringify(pathToFileURL(join(ROOT, 'scripts/lib/cli-utils.js')).href));
  const generated = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(commands(generated.buildNextStepLines(config)), [
    'pnpm install --frozen-lockfile', 'pnpm --filter backend run start:dev', 'pnpm --filter frontend run dev', 'pnpm run setup:prod',
  ]);
  for (const [workspace, script] of [['backend', 'start:dev'], ['frontend', 'dev']]) {
    const manifest = JSON.parse(readFileSync(join(ROOT, workspace, 'package.json')));
    assert.equal(typeof manifest.scripts[script], 'string');
  }
});

test('hooks invoke installed tools through pnpm and preserve a failing gate', (t) => {
  const root = temporary(t);
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  copyFileSync(join(ROOT, 'scripts/lib/require-package-manager.sh'), join(root, 'scripts/lib/require-package-manager.sh'));
  writeFileSync(join(root, 'scripts/check-hard-bans.mjs'), "import { appendFileSync } from 'node:fs'; appendFileSync('calls', 'checker ' + process.argv.slice(2).join(' ') + '\\n'); if (process.env.FAIL_CHECKER === '1') process.exit(1);");
  const binary = join(root, 'bin/pnpm');
  writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$*" >> calls\nif [ "$*" = "$FAIL_COMMAND" ]; then exit 1; fi\n');
  chmodSync(binary, 0o755);
  const env = gitEnvironment({ PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: root });
  for (const [hook, args, expected, status, failure] of [
    ['commit-msg', ['message'], ['exec commitlint --edit message', 'checker --commit-msg message'], 0, ''],
    ['commit-msg', ['message'], ['exec commitlint --edit message'], 1, 'exec commitlint --edit message'],
    ['pre-commit', [], ['exec lint-staged', 'checker --staged'], 0, ''],
    ['pre-commit', [], ['exec lint-staged'], 1, 'exec lint-staged'],
    ['pre-push', ['origin', 'synthetic'], ['checker --push --hook origin synthetic', 'run lint', 'run typecheck'], 1, 'run typecheck'],
    ['pre-push', ['origin', 'synthetic'], ['checker --push --hook origin synthetic'], 1, 'checker'],
  ]) {
    writeFileSync(join(root, 'calls'), '');
    const result = spawnSync('sh', [join(ROOT, '.husky', hook), ...args], { cwd: root, env: { ...env, FAIL_COMMAND: failure, FAIL_CHECKER: failure === 'checker' ? '1' : '0' }, encoding: 'utf8' });
    assert.equal(result.status, status, result.stderr);
    assert.deepEqual(readFileSync(join(root, 'calls'), 'utf8').trim().split('\n'), expected);
  }
});

test('lint-staged selects each importing workspace binary instead of root hoisting', async () => {
  const { default: config } = await import('../../../.lintstagedrc.cjs');
  assert.deepEqual([
    config['backend/**/*.ts'], config['frontend/**/*.{ts,tsx}'],
    config['packages/create-authstack-starter/**/*.ts'], config['shared/core/**/*.ts'],
    config['shared/sdk/**/*.ts'], config['mobile/auth/**/*.ts'],
    config['mobile/cli/**/*.{ts,tsx}'], config['mobile/expo/**/*.{ts,tsx}'],
    config['mobile/metro/**/*.{ts,cjs}'], config['mobile/adapters/**/*.ts'],
    config['mobile/device-key/**/*.ts'],
    config['mobile/ui/**/*.{ts,tsx}'],
  ], [
    ['pnpm --filter backend exec eslint --fix --max-warnings 0'],
    ['pnpm --filter frontend exec eslint --fix --max-warnings 0'],
    ['pnpm --filter create-authstack-starter exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/core exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/sdk exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/native-auth exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/mobile-cli exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/mobile-expo exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/metro-config exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/native-adapters exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/device-key exec eslint --fix --max-warnings 0'],
    ['pnpm --filter @app/native-ui exec eslint --fix --max-warnings 0'],
  ]);
});

test('each hook stops before tools or gates when pnpm is missing', (t) => {
  const root = temporary(t);
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  copyFileSync(join(ROOT, 'scripts/lib/require-package-manager.sh'), join(root, 'scripts/lib/require-package-manager.sh'));
  symlinkSync('/bin/sh', join(root, 'bin/sh'));
  for (const hook of ['commit-msg', 'pre-commit', 'pre-push']) {
    const result = spawnSync('/bin/sh', [join(ROOT, '.husky', hook), 'message'], {
      cwd: root, env: gitEnvironment({ PATH: join(root, 'bin') }), encoding: 'utf8',
    });
    assert.equal(result.status, 1, hook);
    assert.match(result.stderr, /pnpm/);
    assert.doesNotMatch(result.stderr, /not found|Cannot find/);
    assert.equal(result.stdout, '');
  }
});
