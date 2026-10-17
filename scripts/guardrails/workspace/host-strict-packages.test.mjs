import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A host that takes these packages as source compiles them with its own flags,
// from a tsconfig outside this repository.
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CLIENT_PACKAGES = [
  'shared/core',
  'shared/sdk',
  'mobile/auth',
  'mobile/adapters',
  'mobile/device-key',
  'mobile/metro',
];
const HOST_FLAGS = [
  'noPropertyAccessFromIndexSignature',
  'exactOptionalPropertyTypes',
  'noUncheckedIndexedAccess',
  'noImplicitOverride',
  'noImplicitReturns',
  'noFallthroughCasesInSwitch',
];
const HOST_STRICT_OPTIONS = {
  strict: true,
  ...Object.fromEntries(HOST_FLAGS.map((flag) => [flag, true])),
  forceConsistentCasingInFileNames: true,
  noEmit: true,
  skipLibCheck: true,
};
const LANGUAGE_OPTIONS = [
  'target',
  'lib',
  'module',
  'moduleResolution',
  'allowJs',
  'checkJs',
  'types',
  'isolatedModules',
  'verbatimModuleSyntax',
  'esModuleInterop',
];

const temporaryFolders = [];
after(() => {
  for (const folder of temporaryFolders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function temporaryFolder(prefix) {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  temporaryFolders.push(folder);
  const fromRoot = relative(realpathSync(ROOT), realpathSync(folder));
  if (!fromRoot.startsWith('..') && !isAbsolute(fromRoot)) {
    throw new Error(`The host folder ${folder} is inside the repository; point TMPDIR elsewhere`);
  }
  return folder;
}

// Hooks export GIT_* variables; the compiler needs none of them.
const HOST_ENVIRONMENT = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

const WORKSPACE_REQUIRE = createRequire(resolve(ROOT, 'shared/core/package.json'));
const ts = WORKSPACE_REQUIRE('typescript');
const TSC = join(dirname(WORKSPACE_REQUIRE.resolve('typescript/package.json')), 'bin', 'tsc');

function ownConfig(packageDir) {
  const { config, error } = ts.readConfigFile(join(packageDir, 'tsconfig.json'), ts.sys.readFile);
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  return config;
}

function hostConfig(packageDir, hostOptions) {
  const config = ownConfig(packageDir);
  const own = config.compilerOptions ?? {};
  const language = Object.fromEntries(
    LANGUAGE_OPTIONS.filter((option) => option in own).map((option) => [option, own[option]]),
  );
  return {
    compilerOptions: {
      ...language,
      ...hostOptions,
      typeRoots: [join(packageDir, 'node_modules/@types'), join(ROOT, 'node_modules/@types')],
    },
    include: (config.include ?? []).map((glob) => join(packageDir, glob)),
  };
}

function compileAsHost(packageDir, hostOptions = HOST_STRICT_OPTIONS) {
  const host = temporaryFolder('host-strict-');
  writeFileSync(
    join(host, 'tsconfig.json'),
    JSON.stringify(hostConfig(packageDir, hostOptions), null, 2),
  );
  const result = spawnSync(process.execPath, [TSC, '-p', host, '--pretty', 'false'], {
    cwd: ROOT,
    env: HOST_ENVIRONMENT,
    encoding: 'utf8',
  });
  const output = `${result.stdout}${result.stderr}`;
  return {
    status: result.status,
    output,
    codes: [...output.matchAll(/error (TS\d+)/g)].map((m) => m[1]),
  };
}

for (const packagePath of CLIENT_PACKAGES) {
  test(`${packagePath} compiles under a host's strict flags from outside the repository`, () => {
    const { status, output, codes } = compileAsHost(resolve(ROOT, packagePath));
    assert.equal(
      status,
      0,
      `${packagePath} has ${codes.length} diagnostics under host flags:\n${output}`,
    );
  });
}
