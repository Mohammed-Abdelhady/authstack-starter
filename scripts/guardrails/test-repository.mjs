import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitEnvironment } from './git/git-environment.mjs';

const GIT_FIXTURE_CONFIG = {
  'gc.auto': '0',
  'maintenance.auto': 'false',
  'maintenance.autoDetach': 'false',
  'gc.autoDetach': 'false',
  'core.fsmonitor': 'false',
  'fetch.writeCommitGraph': 'false',
};

export function installChecker(root, { directory: target = '.guardrails-runner' } = {}) {
  if (target === 'scripts') {
    // These synthetic projects borrow installed tools without installing packages.
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'verifyDepsBeforeRun: false\n');
    const library = join(root, 'scripts/lib');
    mkdirSync(library, { recursive: true });
    copyFileSync(
      fileURLToPath(new URL('../lib/require-package-manager.sh', import.meta.url)),
      join(library, 'require-package-manager.sh'),
    );
  }
  const directory = join(root, target, 'guardrails');
  mkdirSync(directory, { recursive: true });
  copyFileSync(
    fileURLToPath(new URL('../check-hard-bans.mjs', import.meta.url)),
    join(root, target, 'check-hard-bans.mjs'),
  );
  const copyRuntimeFiles = (source, destination) => {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      const sourcePath = join(source, entry.name);
      const destinationPath = join(destination, entry.name);
      if (entry.isDirectory()) {
        mkdirSync(destinationPath, { recursive: true });
        copyRuntimeFiles(sourcePath, destinationPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.mjs') &&
        !/\.(?:test|slow)\.mjs$/.test(entry.name) &&
        !['test-repository.mjs', 'workspace-policy.mjs', 'workspace-tool-fixture.mjs'].includes(entry.name)
      ) {
        copyFileSync(sourcePath, destinationPath);
      }
    }
  };
  copyRuntimeFiles(fileURLToPath(new URL('.', import.meta.url)), directory);
  return join(root, target, 'check-hard-bans.mjs');
}

// Section by section, since the keys never share one.
const GIT_FIXTURE_CONFIG_TEXT = Object.entries(GIT_FIXTURE_CONFIG)
  .map(([key, value]) => `[${key.split('.')[0]}]\n\t${key.split('.')[1]} = ${value}\n`)
  .join('');

export function repository(t, initArgs = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guardrails-')));
  // Beside the repository, not in it: a test may nest, clone or add repositories
  // with this environment, and none of them reads this one's local config.
  const globalConfig = `${root}.gitconfig`;
  writeFileSync(globalConfig, GIT_FIXTURE_CONFIG_TEXT);
  let entry;
  t.after(() => {
    rmSync(globalConfig, { force: true });
    rmSync(root, { recursive: true, force: true });
  });
  const env = gitEnvironment({
    PATH: process.env.PATH,
    HOME: root,
    XDG_CONFIG_HOME: root,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_AUTHOR_NAME: 'Fixture',
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test',
    GIT_COMMITTER_EMAIL: 'fixture@example.test',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  });
  const git = (...args) =>
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  const write = (filePath, content) => {
    mkdirSync(dirname(join(root, filePath)), { recursive: true });
    writeFileSync(join(root, filePath), content);
  };
  const commit = () => {
    git('add', '.');
    git('commit', '--quiet', '--allow-empty', '-m', 'test: fixture');
    return git('rev-parse', 'HEAD');
  };
  const runCheck = (cwd, args, input) => {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      input,
    });
    const hits = [
      ...result.stderr.matchAll(
        /^(?:\[[a-f0-9]+\] )?(.+?):(\d+): banned token "((?:\\.|[^"\\])*)"/gm,
      ),
    ].map((match) => [match[1], Number(match[2]), JSON.parse(`"${match[3]}"`)]);
    const caps = [...result.stderr.matchAll(/^(?:\[[a-f0-9]+\] )?(.+?): (\d+) lines /gm)].map(
      (match) => [match[1], Number(match[2])],
    );
    return { status: result.status, hits, caps, diagnostic: result.stderr };
  };
  const checkAt = (cwd, ...args) => runCheck(cwd, args);
  const check = (...args) => checkAt(root, ...args);
  const checkInput = (input, ...args) => runCheck(root, args, input);
  git('init', '--initial-branch=feature', ...initArgs);
  // Local config also constrains Git children that remote transports start.
  for (const [key, value] of Object.entries(GIT_FIXTURE_CONFIG)) git('config', key, value);
  entry = installChecker(root);
  appendFileSync(
    resolve(root, git('rev-parse', '--git-path', 'info/exclude')),
    '\n.guardrails-runner/\n',
  );
  return { root, git, write, commit, check, checkAt, checkInput, env, entry };
}

export function outcome(result) {
  return { status: result.status, hits: result.hits, caps: result.caps };
}

export function writeIndexPath(repo, bytes, content) {
  const options = { cwd: repo.root, env: repo.env, stdio: 'pipe' };
  const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { ...options, input: content })
    .toString()
    .trim();
  execFileSync('git', ['update-index', '-z', '--index-info'], {
    ...options,
    input: Buffer.concat([Buffer.from(`100644 ${oid}\t`), Buffer.from(bytes), Buffer.from('\0')]),
  });
}
