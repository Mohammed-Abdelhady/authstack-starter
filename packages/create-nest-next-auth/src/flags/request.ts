import type { PlanRequest } from '../manifest/plan.js';
import type { CliOptions } from '../types.js';
import type { ConfigSelection } from './config-file.js';

/**
 * Merges the two explicit layers into one request. An explicit flag wins over
 * the config file; anything neither names stays undefined so the resolver can
 * fall back to a preset, then the manifest defaults.
 */
export function toPlanRequest(options: CliOptions, config?: ConfigSelection): PlanRequest {
  const request: PlanRequest = {};
  const rules = options.rules ?? config?.rules;
  if (rules !== undefined) request.rules = rules;

  const targets = options.targets ?? config?.targets;
  if (targets !== undefined) request.targets = targets;

  const databases = options.databases ?? config?.databases;
  if (databases !== undefined) request.databases = databases;

  const features = options.features ?? config?.features;
  if (features !== undefined) request.features = features;

  const preset = options.preset ?? config?.preset;
  if (preset !== undefined) request.preset = preset;

  const locales = options.locales ?? config?.locales;
  if (locales !== undefined) request.locales = locales;

  // Field by field: a flag for the name leaves the config file's scheme in place.
  const mobile = { ...(config?.mobile ?? {}), ...(options.mobile ?? {}) };
  if (Object.keys(mobile).length > 0) request.mobile = mobile;

  const overrides = { ...(config?.options ?? {}), ...options.optionOverrides };
  if (Object.keys(overrides).length > 0) request.options = overrides;

  return request;
}
