import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { commandEnvironment } from '../../src/utils/exec.js';
import { discoverBootingSpecs } from './mongodb-spec-discovery.js';
import { loadManifest } from '../../src/manifest/load.js';
import { matchesAnyGlob } from '../../src/utils/glob.js';
import { REPOSITORY } from './database-ownership-support.js';

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--', 'backend/src', 'backend/test'], {
    cwd: REPOSITORY,
    encoding: 'utf8',
    env: commandEnvironment(),
  })
    .split('\0')
    .filter((file) => /\.ts$/.test(file));
}

const BOOTING_SPECS = discoverBootingSpecs(
  Object.fromEntries(
    trackedFiles().map((file) => [file, readFileSync(join(REPOSITORY, file), 'utf8')]),
  ),
);

describe('unit specs that boot the whole app', () => {
  it.each(['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'])(
    'discovers repository specs with hook variable %s pointing elsewhere',
    (variable) => {
      vi.stubEnv(variable, '/nonexistent/authstack-hook-repository');
      try {
        expect(trackedFiles()).toContain(
          'backend/src/session/application-registry.integration.spec.ts',
        );
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  // The unit run starts only MongoDB, so a PostgreSQL project must drop them.
  it('are deleted from a PostgreSQL project by the MongoDB file list', async () => {
    const manifest = await loadManifest(REPOSITORY);
    const booting = BOOTING_SPECS;

    expect({
      notMongoOwned: booting.filter(
        (file) => !matchesAnyGlob(file, manifest.databases.mongodb.files),
      ),
      found: booting.includes('backend/src/session/application-registry.integration.spec.ts'),
    }).toEqual({ notMongoOwned: [], found: true });
  });
});

describe('app-boot discovery', () => {
  it.each([
    ["import { boot } from '../../test/utils/e2e-app';"],
    ["import '../../test/utils/e2e-app';"],
    ["require('../../test/utils/e2e-app');"],
    ["import('../../test/utils/e2e-app');"],
    ["import { boot } from '../../test/utils/e2e-app.js';"],
    ["import '../../test/utils/e2e-app.js';"],
    ["require('../../test/utils/e2e-app.js');"],
    ["import('../../test/utils/e2e-app.js');"],
  ])('discovers %s', (source) => {
    expect(discoverBootingSpecs({ 'backend/src/session/probe.spec.ts': source })).toEqual([
      'backend/src/session/probe.spec.ts',
    ]);
  });

  it('follows test helpers transitively, including a cycle', () => {
    expect(
      discoverBootingSpecs({
        'backend/src/probe.spec.ts': "import 'test/outer.js';",
        'backend/test/outer.ts': "require('./inner');",
        'backend/test/inner.ts': "import './outer'; import('./utils/e2e-app.js');",
      }),
    ).toEqual(['backend/src/probe.spec.ts']);
  });

  it.each(['e2e-app', 'session-authority-harness'])(
    'follows source harnesses and ordinary modules to %s, including a cycle',
    (root) => {
      expect(
        discoverBootingSpecs({
          'backend/src/probe.spec.ts': "import './admin-round-four.harness-spec.js';",
          'backend/src/admin-round-four.harness-spec.ts': "import './bridge';",
          'backend/src/bridge.ts': "export { boot } from 'test/wrapper';",
          'backend/test/wrapper.ts': `import '../src/bridge'; require('./utils/${root}');`,
        }),
      ).toEqual(['backend/src/probe.spec.ts']);
    },
  );

  it('does not follow source specs as helpers', () => {
    expect(
      discoverBootingSpecs({
        'backend/src/probe.spec.ts': "import './other.spec';",
        'backend/src/other.spec.ts': "import 'test/utils/e2e-app';",
      }),
    ).toEqual(['backend/src/other.spec.ts']);
  });

  it('ignores empty inputs, comments, unrelated helpers and boots outside backend/src and backend/test', () => {
    expect(discoverBootingSpecs({})).toEqual([]);
    expect(
      discoverBootingSpecs({
        'backend/src/empty.spec.ts': '',
        'backend/src/comment.spec.ts': "// import 'test/utils/e2e-app';",
        'backend/src/types.spec.ts': "import type { App } from 'test/utils/e2e-app';",
        'backend/src/named-types.spec.ts': "import { type App } from 'test/utils/e2e-app';",
        'backend/src/export-types.spec.ts': "import 'test/types';",
        'backend/test/types.ts': "export type { App } from './utils/e2e-app';",
        'backend/src/plain.spec.ts': "import 'test/plain';",
        'backend/test/plain.ts': "import 'node:fs';",
        'backend/src/outside.spec.ts': "import '../other';",
        'backend/other.ts': "import 'test/utils/e2e-app';",
        'backend/src/unrooted.spec.ts': "import './outer';",
        'backend/src/outer.ts': "import './inner';",
        'backend/src/inner.ts': "import './outer';",
      }),
    ).toEqual([]);
  });
});

describe('session authority app boots', () => {
  it.each<Readonly<Record<string, string>>>([
    { 'backend/src/probe.spec.ts': "import 'test/utils/session-authority-harness.js';" },
    {
      'backend/src/probe.spec.ts': "import 'test/wrapper';",
      'backend/test/wrapper.ts': "require('./utils/session-authority-harness');",
    },
  ])('discovers the authority root and its test helpers', (sources) => {
    expect(discoverBootingSpecs(sources)).toEqual(['backend/src/probe.spec.ts']);
  });
});
