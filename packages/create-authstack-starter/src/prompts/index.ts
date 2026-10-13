import { groupMultiselect, isCancel, text } from '@clack/prompts';
import { FEATURE_KIND_LABELS, FEATURE_KIND_ORDER } from '../constants/index.js';
import { availableFeatures } from '../manifest/select.js';
import type { Manifest } from '../types.js';
import { validateProjectName } from '../utils/project-name.js';

export const CANCELLED = Symbol('cancelled');

interface FeatureOption {
  value: string;
  label: string;
  hint: string;
}

function groupOptions(manifest: Manifest): Record<string, FeatureOption[]> {
  const groups: Record<string, FeatureOption[]> = {};

  for (const kind of FEATURE_KIND_ORDER) {
    const options = availableFeatures(manifest)
      .filter(({ feature }) => feature.kind === kind)
      .map(({ id, feature }) => ({ value: id, label: feature.label, hint: feature.description }));
    if (options.length > 0) groups[FEATURE_KIND_LABELS[kind]] = options;
  }

  return groups;
}

export async function askDirectory(fallback: string): Promise<string | typeof CANCELLED> {
  const answer = await text({
    message: 'Where should the project go?',
    placeholder: fallback,
    defaultValue: fallback,
    validate: (value?: string) => {
      const typed = value ?? '';
      const name = (typed.trim() === '' ? fallback : typed).split('/').pop() ?? '';
      const check = validateProjectName(name);
      return check.valid ? undefined : check.message;
    },
  });

  if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
  return answer.trim() === '' ? fallback : answer.trim();
}

export async function askFeatures(
  manifest: Manifest,
  defaults: string[],
): Promise<string[] | typeof CANCELLED> {
  const answer = await groupMultiselect({
    message: 'Which sign-in methods do you want?',
    options: groupOptions(manifest),
    initialValues: defaults,
    required: true,
    selectableGroups: false,
  });

  if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
  return answer;
}
