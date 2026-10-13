import { DEFAULT_RULES_POLICY, RULES_POLICIES } from '../constants/index.js';
import type { RulesPolicy } from '../types.js';
import { isCancel, multiselect, select } from '@clack/prompts';
import {
  availableDatabaseIds,
  availableOptionIds,
  availableTargetIds,
} from '../manifest/dimensions.js';
import { type PlanRequest, resolvePlan } from '../manifest/plan.js';
import type { Manifest } from '../types.js';
import { askFeatures, CANCELLED } from './index.js';
import { askMobileIdentity, missingMobileFields } from './mobile.js';

export interface PlanPromptNeeds {
  rules: boolean;
  targets: boolean;
  database: boolean;
  features: boolean;
  options: boolean;
  /** A mobile app is already chosen and some of its identity is still open. */
  mobile: boolean;
}

/**
 * A dimension is prompted only when a flag or file did not fix it and the
 * manifest offers more than one available choice. A preset carries targets,
 * features and options but never a database, so it does not suppress that prompt.
 * The rules level and the database came after the first command lines were
 * written, so without a terminal each falls back to its default instead of
 * refusing to run.
 */
export function planPromptNeeds(
  manifest: Manifest,
  request: PlanRequest,
  terminal = true,
): PlanPromptNeeds {
  const presetGiven = request.preset !== undefined;
  const chosen = resolvePlan(manifest, request);
  return {
    mobile: chosen.mobile !== undefined && missingMobileFields(request.mobile ?? {}).length > 0,
    // Without a terminal the level is not asked for: the plan falls back to its default.
    rules: terminal && request.rules === undefined,
    targets:
      !presetGiven && request.targets === undefined && availableTargetIds(manifest).length > 1,
    // Without a terminal the database is not asked for either: a command line
    // written before there was a choice still gets the default.
    database:
      terminal && request.databases === undefined && availableDatabaseIds(manifest).length > 1,
    features: !presetGiven && request.features === undefined,
    options:
      !presetGiven && request.options === undefined && availableOptionIds(manifest).length > 1,
  };
}

async function askTargets(
  manifest: Manifest,
  initial: string[],
): Promise<string[] | typeof CANCELLED> {
  const answer = await multiselect({
    message: 'Which clients do you want?',
    options: availableTargetIds(manifest).map((id) => ({
      value: id,
      label: manifest.targets[id].label,
      ...(manifest.targets[id].description === undefined
        ? {}
        : { hint: manifest.targets[id].description }),
    })),
    initialValues: initial,
    required: true,
  });
  if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
  return answer;
}

export const DATABASE_QUESTION = 'Which database?';

async function askDatabase(
  manifest: Manifest,
  initial: string,
): Promise<string | typeof CANCELLED> {
  const answer = await select({
    message: DATABASE_QUESTION,
    options: availableDatabaseIds(manifest).map((id) => ({
      value: id,
      label: manifest.databases[id].label,
    })),
    initialValue: initial,
  });
  if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
  return answer;
}

async function askOptions(
  manifest: Manifest,
  initial: string[],
): Promise<string[] | typeof CANCELLED> {
  const answer = await multiselect({
    message: 'Project options',
    options: availableOptionIds(manifest).map((id) => ({
      value: id,
      label: manifest.options[id].label,
    })),
    initialValues: initial,
  });
  if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
  return answer;
}

async function askRules(): Promise<RulesPolicy | typeof CANCELLED> {
  const answer = await select({
    message: 'Rules: strict (recommended) or standard',
    options: RULES_POLICIES.map((value) => ({
      value,
      label: value === DEFAULT_RULES_POLICY ? 'strict (recommended)' : value,
    })),
    initialValue: DEFAULT_RULES_POLICY,
  });
  if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
  return answer;
}

/** Collects every prompted dimension into a partial request. */
export async function askPlan(
  manifest: Manifest,
  request: PlanRequest,
  needs: PlanPromptNeeds,
): Promise<Partial<PlanRequest> | typeof CANCELLED> {
  // The same resolution -y would take, so the prompt starts where a default run ends.
  const baseline = resolvePlan(manifest, request);
  const answers: Partial<PlanRequest> = {};

  if (needs.targets) {
    const targets = await askTargets(manifest, baseline.targets);
    if (targets === CANCELLED) return CANCELLED;
    answers.targets = targets;
  }

  // Asked as soon as the clients are known, and only when one of them is a mobile app.
  const withTargets = resolvePlan(manifest, { ...request, ...answers });
  if (withTargets.mobile !== undefined) {
    const given = request.mobile ?? {};
    const mobile = await askMobileIdentity(withTargets.mobile, given);
    if (mobile === CANCELLED) return CANCELLED;
    answers.mobile = { ...given, ...mobile };
  }

  if (needs.database) {
    const database = await askDatabase(manifest, baseline.database);
    if (database === CANCELLED) return CANCELLED;
    answers.databases = [database];
  }

  if (needs.features) {
    const initial = baseline.features.filter((id) => manifest.features[id]?.kind !== 'hidden');
    const features = await askFeatures(manifest, initial);
    if (features === CANCELLED) return CANCELLED;
    answers.features = features;
  }

  if (needs.options) {
    const initial = availableOptionIds(manifest).filter((id) => baseline.options.includes(id));
    const selected = await askOptions(manifest, initial);
    if (selected === CANCELLED) return CANCELLED;
    const overrides: Partial<Record<string, boolean>> = {};
    for (const id of availableOptionIds(manifest)) overrides[id] = selected.includes(id);
    answers.options = overrides;
  }

  if (needs.rules) {
    const rules = await askRules();
    if (rules === CANCELLED) return CANCELLED;
    answers.rules = rules;
  }

  return answers;
}
