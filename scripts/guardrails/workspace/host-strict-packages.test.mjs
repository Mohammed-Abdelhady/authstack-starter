import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
// Each probe compiles cleanly unless its flag is on, and then fails with its code alone.
const HOST_FLAG_PROBES = {
  noPropertyAccessFromIndexSignature: {
    code: 'TS4111',
    source: 'const scores: Record<string, number> = { a: 1 };\nexport const first = scores.a;\n',
  },
  exactOptionalPropertyTypes: {
    code: 'TS2375',
    source: 'interface Box {\n  size?: number;\n}\nexport const box: Box = { size: undefined };\n',
  },
  noUncheckedIndexedAccess: {
    code: 'TS2322',
    source: 'const sizes: number[] = [1];\nexport const size: number = sizes[0];\n',
  },
  noImplicitOverride: {
    code: 'TS4114',
    source:
      'class Base {\n  run(): void {}\n}\nexport class Child extends Base {\n  run(): void {}\n}\n',
  },
  noImplicitReturns: {
    code: 'TS7030',
    source: 'export function pick(flag: boolean) {\n  if (flag) return 1;\n}\n',
  },
  noFallthroughCasesInSwitch: {
    code: 'TS7029',
    source:
      'export function step(value: number): number {\n  let total = 0;\n  switch (value) {\n    case 1:\n      total += 1;\n    case 2:\n      total += 2;\n      break;\n  }\n  return total;\n}\n',
  },
};
const HOST_FLAGS = Object.keys(HOST_FLAG_PROBES);
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
  test(`${packagePath} turns on every host flag in its own tsconfig`, () => {
    const packageDir = resolve(ROOT, packagePath);
    const { options } = ts.parseJsonConfigFileContent(ownConfig(packageDir), ts.sys, packageDir);
    assert.deepEqual(
      HOST_FLAGS.filter((flag) => options[flag] !== true),
      [],
    );
  });

  test(`${packagePath} compiles under a host's strict flags from outside the repository`, () => {
    const { status, output, codes } = compileAsHost(resolve(ROOT, packagePath));
    assert.equal(
      status,
      0,
      `${packagePath} has ${codes.length} diagnostics under host flags:\n${output}`,
    );
  });
}

function probeFixture(source) {
  const fixture = temporaryFolder('host-strict-fixture-');
  mkdirSync(join(fixture, 'src'));
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({ name: 'host-strict-fixture', private: true }),
  );
  writeFileSync(
    join(fixture, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        types: [],
      },
      include: ['src/**/*.ts'],
    }),
  );
  writeFileSync(join(fixture, 'src/index.ts'), source);
  return fixture;
}

for (const [flag, { code, source }] of Object.entries(HOST_FLAG_PROBES)) {
  test(`the host config applies ${flag}`, () => {
    const fixture = probeFixture(source);
    const host = compileAsHost(fixture);
    const withoutFlag = compileAsHost(fixture, { ...HOST_STRICT_OPTIONS, [flag]: false });

    assert.deepEqual(
      { hostCodes: host.codes, withoutFlagStatus: withoutFlag.status },
      { hostCodes: [code], withoutFlagStatus: 0 },
      `${host.output}${withoutFlag.output}`,
    );
  });
}
