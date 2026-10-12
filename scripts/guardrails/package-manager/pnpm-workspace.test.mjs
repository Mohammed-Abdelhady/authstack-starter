import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MANIFESTS = [
  'package.json', 'backend/package.json', 'frontend/package.json',
  'mobile/adapters/package.json', 'mobile/auth/package.json', 'mobile/cli/package.json',
  'mobile/device-key/package.json', 'mobile/expo/package.json',
  'mobile/metro/package.json', 'mobile/ui/package.json',
  'packages/create-nest-next-auth/package.json',
  'shared/core/package.json', 'shared/sdk/package.json',
];
const readManifest = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

test('the pinned pnpm reads workspace patterns, overrides and explicit build decisions', () => {
  const result = spawnSync('pnpm', ['config', 'list'], {
    cwd: ROOT,
    env: { ...process.env, npm_config_manage_package_manager_versions: 'false' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.deepEqual({
    packages: config.packages, overrides: config.overrides,
    allowBuilds: config.allowBuilds, enablePrePostScripts: config.enablePrePostScripts,
    releaseAge: config.minimumReleaseAge,
    releaseAgeStrict: config.minimumReleaseAgeStrict,
    releaseAgeExceptions: config.minimumReleaseAgeExclude ?? [],
  }, {
    packages: ['backend', 'frontend', 'mobile/*', 'packages/*', 'shared/*'],
    overrides: { diff: '>=8.0.3', lodash: '^4.18.1', '@nestjs/platform-express>multer': '2.4.0' },
    allowBuilds: {
      '@embedded-postgres/darwin-arm64': true, '@embedded-postgres/darwin-x64': true,
      '@embedded-postgres/linux-arm64': true, '@embedded-postgres/linux-x64': true,
      '@parcel/watcher': true, '@scarf/scarf': false, '@swc/core': true,
      bcrypt: true, fsevents: true, 'mongodb-memory-server': true, 'unrs-resolver': true,
    },
    enablePrePostScripts: true,
    releaseAge: 1440,
    releaseAgeStrict: true,
    releaseAgeExceptions: [],
  });
});

test('repository manifests pin the package manager and supported Node major without local overrides', () => {
  assert.equal(readManifest('package.json').packageManager, 'pnpm@12.6.0');
  for (const file of MANIFESTS) {
    const manifest = readManifest(file);
    assert.deepEqual(manifest.engines, { node: '>=22.12.0 <23', pnpm: '12.6.0' }, file);
    assert.equal(manifest.overrides, undefined, file);
  }
  assert.deepEqual([
    readManifest('backend/package.json').devDependencies['@app/sdk'],
    readManifest('frontend/package.json').dependencies['@app/core'],
    readManifest('frontend/package.json').dependencies['@app/sdk'],
    readManifest('mobile/auth/package.json').dependencies['@app/sdk'],
    readManifest('shared/sdk/package.json').dependencies['@app/core'],
  ], ['workspace:*', 'workspace:*', 'workspace:*', 'workspace:*', 'workspace:*']);
  for (const shell of ['mobile/cli/package.json', 'mobile/expo/package.json']) {
    const manifest = readManifest(shell);
    assert.deepEqual({
      engine: manifest.dependencies['@app/native-auth'],
      adapters: manifest.dependencies['@app/native-adapters'],
      sdk: manifest.dependencies['@app/sdk'],
      metro: manifest.devDependencies['@app/metro-config'],
    }, {
      engine: 'workspace:*', adapters: 'workspace:*', sdk: 'workspace:*', metro: 'workspace:*',
    }, shell);
  }
  // Both shells use the shared native adapters.
  assert.equal(
    readManifest('mobile/expo/package.json').dependencies['@app/native-adapters'], 'workspace:*',
  );
  assert.deepEqual(readManifest('mobile/adapters/package.json').dependencies, {
    '@app/native-auth': 'workspace:*', '@app/sdk': 'workspace:*',
  });
  // No Expo or React Native here: the shell that owns them hands the native module in.
  assert.deepEqual(readManifest('mobile/device-key/package.json').dependencies, {
    '@app/native-auth': 'workspace:*',
  });
});

test('recursive gates omit the root and chain root config tests once', () => {
  const scripts = readManifest('package.json').scripts;
  assert.deepEqual({
    lint: scripts.lint, fix: scripts['lint:fix'], typecheck: scripts.typecheck,
    build: scripts.build, test: scripts.test, check: scripts.check,
  }, {
    lint: 'pnpm -r --if-present run lint', fix: 'pnpm -r --if-present run lint:fix',
    typecheck: 'pnpm -r --if-present run typecheck', build: 'pnpm -r --if-present run build',
    test: 'pnpm -r --if-present run test && pnpm run test:config',
    check: 'pnpm run check:bans && pnpm run lint && pnpm run typecheck',
  });
  assert.equal(readManifest('backend/package.json').scripts.ci, 'pnpm run lint && pnpm run build && pnpm run test');
  assert.equal(
    readManifest('backend/package.json').scripts['test:debug'],
    'node --inspect-brk -r tsconfig-paths/register -r ts-node/register node_modules/jest/bin/jest.js --runInBand',
  );
  assert.equal(readManifest('frontend/package.json').scripts.lint, 'pnpm run lint:rtl && eslint --max-warnings 0');
  assert.equal(readManifest('packages/create-nest-next-auth/package.json').scripts.prepack, 'pnpm run build');
});
