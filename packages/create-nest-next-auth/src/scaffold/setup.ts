import { log, spinner } from '@clack/prompts';
import { basename, relative } from 'node:path';
import {
  DOCKER_OPTION_ID,
  INSTALL_COMMAND,
  MISSING_PNPM_MESSAGE,
  RULES_POLICY,
} from '../constants/index.js';
import { MOBILE_RUN_COMMAND } from '../constants/mobile.js';
import { RULES_HOOK_PATHS } from '../constants/rules.js';
import { SETUP_CHECK, SETUP_STATUS } from '../constants/setup.js';
import type { Plan } from '../manifest/plan.js';
import type { CliOptions, Manifest } from '../types.js';
import type { SetupCheck, SetupOutcome, SetupSummary } from '../types/setup.js';
import { listFiles } from '../utils/fs.js';
import { initRepository } from './git.js';
import { readHookStatus } from './hooks-status.js';
import { installDependencies, type InstallResult } from './install.js';
import { buildDocLinks, buildNextSteps, readWorkspaceStartScripts } from './next-steps.js';
import { buildSetupSummary } from './setup-summary.js';
import { AGENTS_FILE_NAME, CLAUDE_FILE_NAME } from './rules-text.js';

export async function finishSetup(
  target: string,
  manifest: Manifest,
  plan: Plan,
  options: CliOptions,
  lockfile: InstallResult,
): Promise<SetupSummary> {
  const files = await listFiles(target);
  const checksRun: SetupCheck[] = [
    SETUP_CHECK.PRUNING,
    SETUP_CHECK.REFERENCES,
    SETUP_CHECK.PACKAGE_MANAGER,
  ];
  const skipped: { check: SetupCheck; reason: string }[] = [
    SETUP_CHECK.LINT,
    SETUP_CHECK.TYPECHECK,
    SETUP_CHECK.TESTS,
    SETUP_CHECK.BUILD,
  ].map((check) => ({ check, reason: 'Not run by the installer.' }));
  for (const check of [SETUP_CHECK.BANS, SETUP_CHECK.LENGTH]) {
    skipped.push({
      check,
      reason:
        plan.rules === RULES_POLICY.STANDARD
          ? 'Disabled under standard rules.'
          : 'Not run by the installer.',
    });
  }
  if (lockfile.reason === MISSING_PNPM_MESSAGE) {
    skipped.push({ check: SETUP_CHECK.LOCKFILE, reason: lockfile.reason });
  } else checksRun.push(SETUP_CHECK.LOCKFILE);

  let git: SetupOutcome = { status: SETUP_STATUS.NOT_REQUESTED };
  if (options.git) {
    checksRun.push(SETUP_CHECK.GIT);
    const outcome = await initRepository(target);
    git = {
      status: outcome.ok ? SETUP_STATUS.CREATED : SETUP_STATUS.FAILED,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
    if (outcome.enclosingWorkTree !== undefined) {
      const status = outcome.ok
        ? 'Created a separate repository'
        : 'Separate repository setup failed';
      log.warn(`Target is inside the git work tree at ${outcome.enclosingWorkTree}. ${status}.`);
    }
    if (outcome.ok) log.step('Created a git repository with a first commit');
    else log.error(`Git setup failed: ${outcome.reason ?? 'git is not available'}`);
  } else skipped.push({ check: SETUP_CHECK.GIT, reason: '--no-git' });

  let install: SetupOutcome = { status: SETUP_STATUS.NOT_REQUESTED };
  if (!options.install) skipped.push({ check: SETUP_CHECK.INSTALL, reason: '--no-install' });
  else if (!lockfile.ok) {
    install = {
      status: SETUP_STATUS.BLOCKED,
      reason: lockfile.reason ?? 'The lockfile could not be updated.',
    };
    skipped.push({ check: SETUP_CHECK.INSTALL, reason: install.reason ?? '' });
  } else {
    checksRun.push(SETUP_CHECK.INSTALL);
    const installing = spinner();
    installing.start('Installing dependencies with pnpm');
    const outcome = await installDependencies(target);
    install = {
      status: outcome.ok ? SETUP_STATUS.INSTALLED : SETUP_STATUS.FAILED,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
    };
    installing.stop(outcome.ok ? 'Dependencies installed' : 'pnpm install failed');
    if (!outcome.ok)
      log.error(outcome.reason ?? `Run ${INSTALL_COMMAND} in the project directory.`);
  }

  const hooks = await readHookStatus(target);
  const fromHere = relative(process.cwd(), target);
  const directoryLabel = fromHere === '' ? '.' : fromHere.startsWith('..') ? target : fromHere;
  return buildSetupSummary({
    files: {
      count: files.length,
      instructions: files.filter((file) =>
        [AGENTS_FILE_NAME, CLAUDE_FILE_NAME].includes(basename(file)),
      ),
    },
    rules: plan.rules,
    lockfile: {
      status: lockfile.ok ? SETUP_STATUS.UPDATED : SETUP_STATUS.REMOVED,
      ...(lockfile.reason ? { reason: lockfile.reason } : {}),
    },
    git,
    install,
    ownRepository: hooks.ownRepository,
    hooksIncluded: RULES_HOOK_PATHS.every((path) => files.includes(path)),
    hooksActive: hooks.active,
    checksRun,
    skipped,
    nextSteps: buildNextSteps({
      directoryLabel,
      installed: install.status === SETUP_STATUS.INSTALLED,
      docker: plan.options.includes(DOCKER_OPTION_ID),
      database: plan.database,
      scripts: await readWorkspaceStartScripts(target),
      ...(plan.mobile === undefined ? {} : { mobile: MOBILE_RUN_COMMAND }),
    }),
    docs: buildDocLinks(manifest, plan.features),
  });
}
