import { realpathSync } from 'node:fs';
// Copies the repository into template/ so the published package carries the
// boilerplate. Runs from the package's prebuild script. template/ is gitignored.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestPathProblems } from './manifest-paths.mjs';
import { templateCommit } from './template-commit.mjs';
import { isExcludedPath, selectSources, sourceStats } from './template-sources.mjs';
import TEMPLATE_SYNC_INPUTS from './template-sync-inputs.json' with { type: 'json' };
const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_MANAGER_CONFIG = JSON.parse(
  await readFile(join(PACKAGE_DIR, TEMPLATE_SYNC_INPUTS.manager), 'utf8'),
);
const TEMPLATE_TEST_POLICY = JSON.parse(
  await readFile(join(PACKAGE_DIR, TEMPLATE_SYNC_INPUTS.policy), 'utf8'),
);

const GIT_ENVIRONMENT = JSON.parse(
  await readFile(join(PACKAGE_DIR, TEMPLATE_SYNC_INPUTS.gitEnvironment), 'utf8'),
);

const REPOSITORY_TEST_PATHS = TEMPLATE_TEST_POLICY.EXCLUDED_PATH_PATTERNS.map(
  (pattern) => new RegExp(pattern),
);

const REPO_ROOT = dirname(dirname(PACKAGE_DIR));
const TEMPLATE_DIR = join(PACKAGE_DIR, 'template');
const MANIFEST_NAME = 'template.manifest.json';
// Each database's rewrites, read with the manifest. Mirrors REWRITES_FILE in src/constants.
const REWRITES_NAME = 'template.rewrites.json';
// Mirrors TEMPLATE_IDENTITY_FILE in src/constants: the template's content
// hash, shipped next to template/ and recorded in generated projects.
const TEMPLATE_IDENTITY_FILE = 'template.identity.json';
const INSTRUCTION_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

// Directory names dropped wherever they appear.
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'out',
  'coverage',
  '.turbo',
  'output',
  'test-results',
  'playwright-report',
  'blob-report',
  '.auth',
  '.mongodb-binaries',
  'mongodb-memory-server',
  'mongodb-data',
  '.ssh',
  '.aws',
  '.kube',
  'ssl',
]);

// Paths dropped relative to the repository root. Maintainer tooling is not
// part of a generated project.
const EXCLUDED_PATHS = new Set([
  '.github/CODEOWNERS',
  '.hyperflow',
  '.claude',
  '.codex',
  '.agents',
  '.kilocode',
  'openspec',
  'packages',
  ...INSTRUCTION_FILES,
  MANIFEST_NAME,
  REWRITES_NAME,
  join('.husky', '_'),
]);

const ENV_EXAMPLES = new Set([
  '.env.docker.example',
  join('backend', '.env.example'),
  join('frontend', '.env.example'),
]);

// npm drops these names from a published tarball, so they travel under a
// different name and the CLI renames them back while scaffolding.
const RENAMED_FILES = new Map([
  ['.gitignore', '_gitignore'],
  ['.npmrc', '_npmrc'],
  [PACKAGE_MANAGER_CONFIG.PNPM_LOCKFILE, PACKAGE_MANAGER_CONFIG.PACKED_PNPM_LOCKFILE],
]);

export function isExcluded(relativePath, name, isDirectory) {
  if (name === '.git') return true;
  if (EXCLUDED_PATHS.has(relativePath)) return true;
  if (REPOSITORY_TEST_PATHS.some((pattern) => pattern.test(relativePath.split(sep).join('/'))))
    return true;
  if (/(^|[\\/])\.config[\\/]gcloud($|[\\/])/.test(relativePath)) return true;
  if (name === '.env' || name.startsWith('.env.'))
    return isDirectory || !ENV_EXAMPLES.has(relativePath);
  if (/\.(pem|key|crt|tgz)$/i.test(name)) return true;
  if (isDirectory) return EXCLUDED_DIRS.has(name);
  if (name === '.DS_Store' || name.endsWith('.log') || name.endsWith('.tsbuildinfo')) return true;
  return false;
}

function removeInstallerImporter(bytes) {
  const lines = bytes.toString('utf8').split('\n');
  const start = lines.findIndex((line) => line === '  packages/create-authstack-starter:');
  if (start === -1) return bytes;
  let end = start + 1;
  while (end < lines.length && !/^(?:  [^ ]|[^ #][^:]*:|---$)/.test(lines[end])) end += 1;
  return Buffer.from([...lines.slice(0, start), ...lines.slice(end)].join('\n'));
}

export function templateContent(relativePath, bytes) {
  if (relativePath === '.gitignore') {
    const lines = bytes.toString('utf8').match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
    const kept = lines.filter((line) => {
      const content = line.replace(/(?:\r\n|\r|\n)$/, '');
      return !INSTRUCTION_FILES.has(content);
    });
    return Buffer.from(kept.join(''));
  }
  if (relativePath === PACKAGE_MANAGER_CONFIG.PNPM_LOCKFILE) return removeInstallerImporter(bytes);
  if (relativePath === TEMPLATE_TEST_POLICY.POLICY_PATH) {
    const content = bytes.toString('utf8');
    const updated = content.replace(
      /(export const EXEMPT_PATHS = \[)([^\]]*)(\];)/,
      (_match, start, values, end) => {
        const paths = [...values.matchAll(/(['"])([^'"]+)\1/g)]
          .filter((match) => !REPOSITORY_TEST_PATHS.some((pattern) => pattern.test(match[2])))
          .map((match) => match[0]);
        return `${start}${paths.join(', ')}${end}`;
      },
    );
    return Buffer.from(updated);
  }
  if (relativePath === TEMPLATE_TEST_POLICY.CI_CONFIG_PATH) {
    const config = JSON.parse(bytes.toString('utf8'));
    config.gates = config.gates
      .filter((gate) => !gate.repositoryOnly)
      .map(({ repositoryOnly, ...gate }) => gate);
    // A group whose gates were all repository-only is not a group of the project.
    if (Array.isArray(config.groups))
      config.groups = config.groups.filter((group) =>
        config.gates.some((gate) => gate.group === group),
      );
    return Buffer.from(`${JSON.stringify(config, null, 2)}\n`);
  }
  const workflow = TEMPLATE_TEST_POLICY.WORKFLOW_PATHS.includes(relativePath);
  if (workflow)
    bytes = Buffer.from(
      bytes
        .toString('utf8')
        .replaceAll('branches: [staging, master]', 'branches: [staging, master, main]'),
    );
  if (!workflow && relativePath !== TEMPLATE_TEST_POLICY.DOC_PATH && relativePath !== 'README.md')
    return bytes;
  const start = workflow
    ? TEMPLATE_TEST_POLICY.WORKFLOW_ONLY_START
    : TEMPLATE_TEST_POLICY.REPOSITORY_ONLY_START;
  const end = workflow
    ? TEMPLATE_TEST_POLICY.WORKFLOW_ONLY_END
    : TEMPLATE_TEST_POLICY.REPOSITORY_ONLY_END;
  let excluded = false;
  const kept = [];
  for (const line of bytes.toString('utf8').split('\n')) {
    if (line.trim() === start) excluded = true;
    else if (line.trim() === end) excluded = false;
    else if (!excluded) kept.push(line);
  }
  return Buffer.from(kept.join('\n'));
}

// One entry: shipped path, executable bit, content digest. Fields are NUL
// framed (a file name cannot contain NUL, so no name can forge a field or a
// second line) and the whole entry travels as one sorted line.
function entryLine(path, mode, bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `${path}\0${(mode & 0o111) === 0 ? '0' : '1'}\0${digest}`;
}

// Git decides which repository a command reads from these before it looks at
// the working directory. A hook exports them, so they are dropped here.
const GIT_OUTPUT_LIMIT = 64 * 1024 * 1024;

function git(root, args) {
  const env = { ...process.env };
  for (const variable of Object.keys(env)) {
    if (
      GIT_ENVIRONMENT.variables.includes(variable) ||
      GIT_ENVIRONMENT.prefixes.some((prefix) => variable.startsWith(prefix))
    )
      delete env[variable];
  }
  const result = spawnSync('git', args, {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: GIT_OUTPUT_LIMIT,
  });
  if (result.error) {
    throw new Error(
      `Template sync copies only files tracked by Git, and git could not be run: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Template sync copies only files tracked by Git, and ${root} is not the root of a Git repository: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

// An untracked file never ships, whatever its name: a local .npmrc, an editor
// folder or a scratch file is not part of the template.
export function trackedFiles(root) {
  const prefix = git(root, ['rev-parse', '--show-prefix']).trim();
  if (prefix !== '') {
    throw new Error(
      `Template sync copies only files tracked by Git, and ${root} is not the root of a Git repository: it sits inside another repository at ${prefix}`,
    );
  }
  return git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
}

// The build inputs outside template/ that decide its bytes, as Git names them.
const BUILD_INPUTS = [
  MANIFEST_NAME,
  REWRITES_NAME,
  ...Object.values(TEMPLATE_SYNC_INPUTS).map((input) =>
    relative(REPO_ROOT, join(PACKAGE_DIR, input)).split(sep).join('/'),
  ),
];

// Whether a path Git reports decides the template's bytes: a shipped file or a build input.
function isTemplateSource(path) {
  return BUILD_INPUTS.includes(path) || !isExcludedPath(path.split('/'), isExcluded);
}

// The build inputs read from disk, as provenance compares them. Rewrites count only when tracked.
async function readBuildInputs(trackedPaths) {
  const inputs = [];
  for (const path of BUILD_INPUTS) {
    if (path === REWRITES_NAME && !trackedPaths.includes(REWRITES_NAME)) continue;
    const source = join(REPO_ROOT, ...path.split('/'));
    const stats = await sourceStats(REPO_ROOT, source);
    if (stats !== null) inputs.push({ path, mode: stats.mode, bytes: await readFile(source) });
  }
  return inputs;
}

// Copies what the selection ships and records each source's original bytes in build.copied.
async function copyTracked(trackedPaths, build) {
  for (const { path: tracked, stats } of await selectSources(REPO_ROOT, trackedPaths, isExcluded)) {
    const segments = tracked.split('/');
    const relativePath = segments.join(sep);
    const source = join(REPO_ROOT, relativePath);

    const name = segments.at(-1);
    const shipped = [...segments.slice(0, -1), RENAMED_FILES.get(name) ?? name].join('/');
    const clash = build.shippedBy.get(shipped);
    if (clash !== undefined) {
      // The rename table could map two sources onto one shipped path; only one
      // of them would survive the copy, so the identity would lie.
      throw new Error(`Two template files ship as ${shipped}: ${clash} and ${relativePath}`);
    }
    build.shippedBy.set(shipped, relativePath);

    const target = join(TEMPLATE_DIR, ...shipped.split('/'));
    const original = await readFile(source);
    build.copied.push({ path: tracked, mode: stats.mode, bytes: original });
    const bytes = templateContent(tracked, original);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
    if (!bytes.equals(original)) await writeFile(target, bytes);
    build.counters.files += 1;
    build.counters.bytes += bytes.length;
    build.hashes.push(entryLine(shipped, stats.mode, bytes));
  }
}

async function main() {
  // Both artifacts go together: a failed build must not leave an identity
  // beside a half-copied or stale template.
  await rm(TEMPLATE_DIR, { recursive: true, force: true });
  await rm(join(PACKAGE_DIR, TEMPLATE_IDENTITY_FILE), { force: true });
  const build = { counters: { files: 0, bytes: 0 }, hashes: [], shippedBy: new Map(), copied: [] };
  const { counters, hashes } = build;
  await mkdir(TEMPLATE_DIR, { recursive: true });
  const trackedPaths = trackedFiles(REPO_ROOT);
  await copyTracked(trackedPaths, build);

  const manifestPath = join(REPO_ROOT, MANIFEST_NAME);
  const manifestBytes = await readFile(manifestPath);
  const manifest = manifestBytes.toString('utf8');
  const problems = manifestPathProblems(JSON.parse(manifest), trackedPaths);
  if (problems.length > 0) {
    throw new Error(`template.manifest.json is invalid:\n  ${problems.join('\n  ')}`);
  }
  await writeFile(join(PACKAGE_DIR, MANIFEST_NAME), manifest, 'utf8');

  // The rewrites decide what the files become as much as the manifest does,
  // so they ship beside it and count toward the identity.
  await rm(join(PACKAGE_DIR, REWRITES_NAME), { force: true });
  const rewritesPath = join(REPO_ROOT, REWRITES_NAME);
  if (trackedPaths.includes(REWRITES_NAME)) {
    const rewritesBytes = await readFile(rewritesPath);
    JSON.parse(rewritesBytes.toString('utf8'));
    await writeFile(join(PACKAGE_DIR, REWRITES_NAME), rewritesBytes);
    hashes.push(entryLine(REWRITES_NAME, (await stat(rewritesPath)).mode, rewritesBytes));
  }

  // One identity for what ships: every template file's shipped path,
  // executable bit and content digest, plus the manifest that decides what
  // those files become. Entries are NUL framed and sorted, a collision on a
  // shipped path is an error above, and any rename, mode change, added or
  // edited file, or manifest edit changes the digest. Two different templates
  // cannot share one identity.
  const manifestStats = await stat(manifestPath);
  hashes.push(entryLine(MANIFEST_NAME, manifestStats.mode, manifestBytes));
  hashes.sort();
  const identity = createHash('sha256')
    .update(`${hashes.join('\n')}\n`)
    .digest('hex');
  const copied = [...build.copied, ...(await readBuildInputs(trackedPaths))];
  const commit = templateCommit(git, REPO_ROOT, { copied, isTemplateSource });
  await writeFile(
    join(PACKAGE_DIR, TEMPLATE_IDENTITY_FILE),
    `${JSON.stringify({ sha256: identity, commit }, null, 2)}\n`,
    'utf8',
  );

  const megabytes = (counters.bytes / 1024 / 1024).toFixed(1);
  console.log(`template: ${counters.files} files, ${megabytes} MB`);
  console.log(`manifest: ${Object.keys(JSON.parse(manifest).features).length} features`);
  console.log(`identity: sha256:${identity}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
