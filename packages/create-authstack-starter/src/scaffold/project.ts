import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { log, outro, spinner } from '@clack/prompts';
import { LOCKFILE_FAILURE } from '../constants/index.js';
import { RULES_HOOK_PATHS, RULES_WORKFLOW_PATH } from '../constants/rules.js';
import { resolveOwnership } from '../manifest/ownership.js';
import type { Plan } from '../manifest/plan.js';
import { applyMobileIdentity } from '../mobile/apply.js';
import { templateDir } from '../paths.js';
import { prune } from '../prune/index.js';
import {
  describeDangling,
  describePossiblyPrunedRules,
  describeSelection,
  describeUnexplainedRules,
} from '../report.js';
import type { AnswersRecord, CliOptions, Manifest, PruneResult } from '../types.js';
import type { SetupSummary } from '../types/setup.js';
import { recordAnswers } from './answers.js';
import { copyTemplate } from './copy.js';
import { type InstallResult, prepareLockfile } from './install.js';
import { setProjectName } from './package-json.js';
import { writeRulesText } from './rules-text.js';
import { finishSetup } from './setup.js';

/**
 * Without the pinned pnpm the lockfile is gone and generation goes on. Any other
 * failure stops it with the copied lockfile in place, and returns undefined.
 */
async function updateLockfile(
  target: string,
  install: boolean,
): Promise<InstallResult | undefined> {
  const updating = spinner();
  updating.start('Updating pnpm lockfile');
  let lockfile: InstallResult;
  try {
    lockfile = await prepareLockfile(target);
  } catch (error) {
    updating.stop('pnpm lockfile update failed');
    const reason = error instanceof Error ? error.message : String(error);
    log.error(`Could not prepare the pnpm lockfile: ${reason}`);
    outro(`Left the tree at ${target} so you can inspect it.`);
    return undefined;
  }
  updating.stop(lockfile.ok ? 'pnpm lockfile updated' : 'pnpm lockfile update failed');
  if (lockfile.ok) return lockfile;
  if (lockfile.kind !== LOCKFILE_FAILURE.MISSING_PNPM) {
    log.error(`Could not update the pnpm lockfile: ${lockfile.reason ?? 'pnpm gave no reason.'}`);
    outro(`Left the tree at ${target} so you can inspect it.`);
    return undefined;
  }
  if (install) {
    log.error(`pnpm-lock.yaml removed; dependency installation was skipped. ${lockfile.reason}`);
  } else log.message(`pnpm-lock.yaml removed. ${lockfile.reason}`);
  return lockfile;
}

export async function scaffoldProject(
  target: string,
  manifest: Manifest,
  plan: Plan,
  options: CliOptions,
  answers: AnswersRecord,
): Promise<SetupSummary | undefined> {
  const copying = spinner();
  copying.start('Copying the template');
  try {
    await copyTemplate(templateDir(), target);
    await setProjectName(target, basename(target));
  } catch (error) {
    copying.stop('Copying failed');
    log.error(error instanceof Error ? error.message : String(error));
    outro(`Left the tree at ${target} so you can inspect it.`);
    return undefined;
  }
  copying.stop('Template copied');

  const pruning = spinner();
  pruning.start('Removing what you did not pick');
  let result: PruneResult;
  try {
    result = await prune(
      target,
      manifest,
      plan.features,
      plan.options,
      plan.rules,
      resolveOwnership(manifest, plan),
      [plan.database],
    );
    if (plan.mobile !== undefined) await applyMobileIdentity(target, plan.targets, plan.mobile);
  } catch (error) {
    pruning.stop('Pruning failed');
    const reason = error instanceof Error ? error.message : String(error);
    log.error(`Pruning failed: ${reason}`);
    outro(`Left the tree at ${target} so you can inspect it.`);
    return undefined;
  }
  pruning.stop('Pruned');
  await writeRulesText({
    projectRoot: target,
    level: plan.rules,
    delivery: {
      hooks: RULES_HOOK_PATHS.every((path) => existsSync(join(target, path))),
      actions: existsSync(join(target, RULES_WORKFLOW_PATH)),
    },
  });
  log.message(describeSelection(manifest, result).join('\n'));
  const lockfile = await updateLockfile(target, options.install);
  if (lockfile === undefined) return undefined;
  if (result.dangling.length > 0) {
    log.error(describeDangling(result.dangling).join('\n'));
    outro(`Left the tree at ${target} so you can inspect it.`);
    return undefined;
  }
  if (result.unexplainedDatabaseRules.length > 0) {
    log.error(describeUnexplainedRules(result.unexplainedDatabaseRules).join('\n'));
    outro(`Left the tree at ${target} so you can inspect it.`);
    return undefined;
  }
  if (result.unmatchedDatabaseRules.length > 0) {
    log.warn(describePossiblyPrunedRules(result.unmatchedDatabaseRules).join('\n'));
  }

  // Records how the project was made, before any git commit and on runs that
  // skip git or install alike. --dry-run never reaches this branch.
  await recordAnswers(target, answers);

  return finishSetup(target, manifest, plan, options, lockfile);
}
