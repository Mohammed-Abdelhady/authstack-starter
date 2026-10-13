import { Command, Option } from 'commander';
import { CLI_NAME, RULES_POLICIES, RULES_POLICY } from '../constants/index.js';
import { ADD_RULES_AGENT_COPY } from '../constants/rules.js';
import type { AddRulesOptions } from '../types/add-rules.js';

export function parseAddRulesOptions(argv: string[], version: string): AddRulesOptions {
  const program = new Command()
    .name(`${CLI_NAME} add rules`)
    .version(version)
    .exitOverride()
    .addOption(
      new Option('--rules <level>', 'strict or standard rules')
        .choices([...RULES_POLICIES])
        .default(RULES_POLICY.STRICT),
    )
    .addOption(
      new Option(
        '--agents-file <file>',
        'preserve existing AGENTS.md and write a separate file',
      ).choices([ADD_RULES_AGENT_COPY]),
    )
    .option('--dry-run', 'print exact file content without writing')
    .option('-y, --yes', 'confirm the displayed plan')
    .allowExcessArguments(false);
  program.parse(argv, { from: 'user' });
  const raw = program.opts<AddRulesOptions>();
  return { ...raw, dryRun: raw.dryRun === true, yes: raw.yes === true };
}
