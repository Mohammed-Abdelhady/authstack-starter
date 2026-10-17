import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkWorkspaceDependencies } from './check-workspace-dependencies.mjs';

function fixture(t, files, manifest = {}) {
  const root = mkdtempSync(join(tmpdir(), 'workspace-dependencies-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contents = {
    'package.json': JSON.stringify({ workspaces: ['apps/*', 'shared/core'] }),
    'apps/web/package.json': JSON.stringify({ name: 'web', ...manifest }),
    ...files,
  };
  for (const [file, content] of Object.entries(contents)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

test('runtime, type, re-export, dynamic and CommonJS imports require local declarations', (t) => {
  const root = fixture(t, {
    'apps/web/src/main.ts':
      "import client from 'runtime';\nimport type { T } from '@scope/types/subpath';\nexport { helper } from 'reexport';\nimport('dynamic/subpath');\nconst tool = require('commonjs');\n",
  });
  assert.deepEqual(checkWorkspaceDependencies(root), [
    { file: 'apps/web/src/main.ts', package: '@scope/types' },
    { file: 'apps/web/src/main.ts', package: 'commonjs' },
    { file: 'apps/web/src/main.ts', package: 'dynamic' },
    { file: 'apps/web/src/main.ts', package: 'reexport' },
    { file: 'apps/web/src/main.ts', package: 'runtime' },
  ]);
});

test('dependencies, development, peer and optional declarations satisfy imports', (t) => {
  const root = fixture(
    t,
    {
      'apps/web/test/dependencies.mts':
        "import 'runtime'; import 'development'; import 'peer'; import 'optional';",
    },
    {
      dependencies: { runtime: '1.0.0' },
      devDependencies: { development: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      optionalDependencies: { optional: '1.0.0' },
    },
  );
  assert.deepEqual(checkWorkspaceDependencies(root), []);
});

test('root and sibling dependencies do not satisfy a workspace import, including configs', (t) => {
  const root = fixture(t, {
    'package.json': '{"workspaces":["apps/*","shared/core"],"dependencies":{"root-only":"1.0.0"}}',
    'shared/core/package.json': '{"name":"core","dependencies":{"sibling-only":"1.0.0"}}',
    'apps/web/vitest.config.ts': "import 'root-only'; import 'sibling-only';",
  });
  assert.deepEqual(checkWorkspaceDependencies(root), [
    { file: 'apps/web/vitest.config.ts', package: 'root-only' },
    { file: 'apps/web/vitest.config.ts', package: 'sibling-only' },
  ]);
});

test('built-ins, relative imports, configured aliases and self imports are local', (t) => {
  const root = fixture(
    t,
    {
      'apps/web/tsconfig.json': '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}',
      'apps/web/src/main.ts':
        "import 'node:fs'; import 'fs/promises'; import './local.js'; import '../other'; import '@/local'; import 'web/subpath'; import '#internal';",
    },
    { imports: { '#internal': './src/internal.js' } },
  );
  assert.deepEqual(checkWorkspaceDependencies(root), []);
});

test('comments and quoted code examples are not imports, installed and generated trees are ignored', (t) => {
  const root = fixture(t, {
    'apps/web/src/main.ts':
      '// import "comment";\n/* require("comment") */\nconst text = "import \'example\'";\nconst template = `import "example"`;\n',
    'apps/web/node_modules/library/index.js': "import 'transitive';",
    'apps/web/dist/main.js': "import 'output';",
    'apps/web/template/index.ts': "import 'template';",
  });
  assert.deepEqual(checkWorkspaceDependencies(root), []);
});

for (const [name, source] of [
  ['JSX text', "const view = <p>Don't forget.</p>;\nimport 'missing';"],
  ['regular expression', "const expression = /'/;\nimport 'missing';"],
  ['control-flow regular expression', "if (condition) /'/.test(value);\nimport 'missing';"],
  ['template expression', 'const value = `${require("missing")}`;'],
  ['nested template expression', 'const value = `${`${import("missing")}`}`;'],
  ['resolution', 'require.resolve("missing/subpath");'],
  ['JSX attribute expression', 'const view = <p value={require("missing")} />;'],
  ['generic arrow', 'const value = <T>(value: T) => value;\nimport "missing";'],
]) {
  test(`executable imports after or inside ${name} cannot be hidden`, (t) => {
    const root = fixture(t, { 'apps/web/src/main.tsx': source });
    assert.deepEqual(checkWorkspaceDependencies(root), [
      { file: 'apps/web/src/main.tsx', package: 'missing' },
    ]);
  });
}

test('empty workspace trees and an absent wildcard match pass', (t) => {
  assert.deepEqual(checkWorkspaceDependencies(fixture(t, {})), []);
});

test('invalid manifests fail instead of silently omitting a workspace', (t) => {
  const root = fixture(t, { 'apps/web/package.json': '{' });
  assert.throws(() => checkWorkspaceDependencies(root), /JSON/);
});

test('the CLI fails for a phantom dependency and succeeds after its manifest is fixed', (t) => {
  const root = fixture(t, { 'apps/web/src/main.ts': "import 'missing';" });
  const script = new URL('./check-workspace-dependencies.mjs', import.meta.url);
  const run = () => spawnSync(process.execPath, [script.pathname], { cwd: root, encoding: 'utf8' });
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /apps\/web\/src\/main\.ts: undeclared dependency missing/);
  writeFileSync(join(root, 'apps/web/package.json'), '{"dependencies":{"missing":"1.0.0"}}');
  assert.equal(run().status, 0);
});
