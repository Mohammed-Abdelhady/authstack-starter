import { addRulesCommand } from './add-rules/command.js';
import { readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { cancel, intro, log, note, outro } from '@clack/prompts';
import { CommanderError } from 'commander';
import { BROKEN_PACKAGE_EXIT_CODE, CLI_NAME, USAGE_EXIT_CODE } from './constants/index.js';
import { MOBILE_DEFAULT_PROJECT_NAME } from './constants/mobile.js';
import { ConfigFileError, readConfigFile } from './flags/config-file.js';
import { parseCliOptions } from './flags/options.js';
import { toPlanRequest } from './flags/request.js';
import { CliError, BrokenPackageError } from './errors.js';
import { loadManifest } from './manifest/load.js';
import { resolvePlan } from './manifest/plan.js';
import type { PlanError } from './manifest/plan-types.js';
import { resolveMobileIdentity } from './mobile/identity.js';
import { packageRoot } from './paths.js';
import { askDirectory, CANCELLED } from './prompts/index.js';
import { askPlan, type PlanPromptNeeds, planPromptNeeds } from './prompts/plan.js';
import { buildSummary, describePlanErrors } from './report/summary.js';
import { answersRecord, readInstallerIdentity, readTemplateIdentity } from './scaffold/answers.js';
import type { CliOptions } from './types.js';
import { scaffoldProject } from './scaffold/project.js';
import { renderSetupSummary } from './report/setup-summary.js';
import { isErrnoException } from './utils/fs.js';
import { validateProjectName } from './utils/project-name.js';

const DEFAULT_DIRECTORY = 'my-app';

async function isEmptyDirectory(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return true;
    throw error;
  }
}

async function validateTarget(input: string): Promise<string> {
  const target = resolve(process.cwd(), input);
  const check = validateProjectName(basename(target));
  if (!check.valid) throw new CliError(check.message ?? 'Invalid project name.');
  if (!(await isEmptyDirectory(target))) throw new CliError(`${target} exists and is not empty.`);
  return target;
}

async function resolveTarget(options: CliOptions): Promise<string> {
  let input = options.directory;

  if (input === undefined) {
    if (options.yes) {
      input = DEFAULT_DIRECTORY;
    } else {
      const answer = await askDirectory(DEFAULT_DIRECTORY);
      if (answer === CANCELLED) throw new CliError('Cancelled.');
      input = answer;
    }
  }

  return validateTarget(input);
}

interface PromptNeeds extends PlanPromptNeeds {
  directory: boolean;
}

function requireInteractive(options: CliOptions, needs: PromptNeeds): void {
  const needsPrompt =
    needs.directory ||
    needs.targets ||
    needs.database ||
    needs.features ||
    needs.options ||
    needs.mobile ||
    needs.rules;
  if (!needsPrompt || options.yes || process.stdin.isTTY === true) return;
  throw new CliError('No terminal to prompt in. Pass --yes or the matching flags.');
}

export async function main(
  argv: string[],
  manifestRoot = packageRoot(),
  installerRoot = packageRoot(),
): Promise<number> {
  try {
    // The installer identifies itself once, before anything is parsed or
    // written: commander prints this version, the answers file records it,
    // and a damaged package stops a scaffolding run and a dry run alike.
    const installer = await readInstallerIdentity(installerRoot);
    if (argv[0] === 'add' && argv[1] === 'rules')
      return await addRulesCommand(argv.slice(2), installer.version, installerRoot);
    const options = parseCliOptions(argv, installer.version);
    intro(`${CLI_NAME} ${installer.version}`);

    const manifest = await loadManifest(manifestRoot);
    const template = await readTemplateIdentity(manifestRoot);
    const config =
      options.config === undefined
        ? undefined
        : await readConfigFile(options.config, { manifest, template });
    const request = toPlanRequest(options, config);

    // Flags and the config file are authoritative. Report their errors before
    // any prompt, so an invalid run never asks a question first.
    const terminal = process.stdin.isTTY === true;
    const needs: PromptNeeds = {
      directory: !options.dryRun && options.directory === undefined,
      ...planPromptNeeds(manifest, request, terminal),
    };
    // A mobile flag may be waiting for the clients question, so whether it is used is judged
    // after the answer. Its value is wrong whatever the answer, so that is judged now.
    const asksClients = needs.targets && !options.yes && terminal;
    const requested: PlanError[] = resolvePlan(manifest, request).errors.filter(
      (error) => !(asksClients && error.reason === 'identity-unused'),
    );
    if (asksClients && !requested.some((error) => error.reason === 'identity')) {
      const given = request.mobile ?? {};
      for (const { field, message } of resolveMobileIdentity(given, MOBILE_DEFAULT_PROJECT_NAME)
        .problems) {
        requested.push({ id: field, reason: 'identity', message });
      }
    }
    if (requested.length > 0) {
      for (const line of describePlanErrors(manifest, requested)) log.error(line);
      outro('Nothing was written.');
      return USAGE_EXIT_CODE;
    }
    requireInteractive(options, needs);

    const target = options.dryRun
      ? options.directory === undefined
        ? ''
        : await validateTarget(options.directory)
      : await resolveTarget(options);
    // The mobile app's defaults are built from the name the project was given.
    if (target !== '') request.projectName = basename(target);

    if (!options.yes) {
      const answers = await askPlan(manifest, request, needs);
      if (answers === CANCELLED) throw new CliError('Cancelled.');
      Object.assign(request, answers);
    }

    const plan = resolvePlan(manifest, request);
    if (plan.errors.length > 0) {
      for (const line of describePlanErrors(manifest, plan.errors)) log.error(line);
      outro('Nothing was written.');
      return USAGE_EXIT_CODE;
    }
    if (plan.features.length === 0) throw new CliError('Select at least one sign-in method.');

    log.message(buildSummary(manifest, plan).join('\n'));

    if (options.dryRun) {
      outro('Dry run: nothing written.');
      return 0;
    }

    const summary = await scaffoldProject(
      target,
      manifest,
      plan,
      options,
      answersRecord(installer, template, plan),
    );
    if (summary === undefined) return 1;
    note(renderSetupSummary(summary).join('\n'), 'Generation summary');
    note(summary.nextSteps.join('\n'), 'Next steps');
    note(summary.docs.join('\n'), 'Docs');
    if (summary.exitCode === 0) outro('Done.');
    return summary.exitCode;
  } catch (error) {
    // Commander's own exits (--help, --version, flag syntax) keep its codes.
    if (error instanceof CommanderError) throw error;
    if (error instanceof BrokenPackageError) {
      cancel(error.message);
      return BROKEN_PACKAGE_EXIT_CODE;
    }
    if (error instanceof ConfigFileError || error instanceof CliError) {
      cancel(error.message);
      return USAGE_EXIT_CODE;
    }
    throw error;
  }
}
