import { confirm, isCancel, log, note, outro } from '@clack/prompts';
import { join } from 'node:path';
import { USAGE_EXIT_CODE } from '../constants/index.js';
import { parseAddRulesOptions } from '../flags/add-rules.js';
import { renderSetupSummary } from '../report/setup-summary.js';
import { applyRules, planRules, renderRulesPlan } from './plan.js';

export async function addRulesCommand(
  argv: string[],
  version: string,
  installerRoot: string,
): Promise<number> {
  const options = parseAddRulesOptions(argv, version);
  try {
    const plan = await planRules(
      process.cwd(),
      options.rules,
      join(installerRoot, 'template'),
      options.agentsFile,
    );
    log.message(renderRulesPlan(plan));
    note(renderSetupSummary(plan.summary).join('\n'), 'Rules plan summary');
    if (plan.blockers.length) {
      outro('Nothing written. Resolve the listed conflicts first.');
      return USAGE_EXIT_CODE;
    }
    if (options.dryRun || plan.files.length === 0) {
      outro('Nothing written.');
      return 0;
    }
    if (!options.yes) {
      if (process.stdin.isTTY !== true) {
        outro('No terminal to confirm. Pass --yes or --dry-run. Nothing written.');
        return USAGE_EXIT_CODE;
      }
      const answer = await confirm({ message: 'Write the exact files shown above?' });
      if (isCancel(answer) || !answer) {
        outro('Cancelled. Nothing written.');
        return 0;
      }
    }
    const result = await applyRules(plan);
    note(renderSetupSummary(result).join('\n'), 'Rules summary');
    return 0;
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    outro('Rules command failed. Review the reason above.');
    return USAGE_EXIT_CODE;
  }
}
