import { isCancel, text } from '@clack/prompts';
import { MOBILE_IDENTITY_FIELDS, MOBILE_PROMPTS } from '../constants/mobile.js';
import { checkMobileField } from '../mobile/identity.js';
import type { MobileIdentity, MobileIdentityRequest } from '../types/mobile.js';
import { CANCELLED } from './index.js';

/** The fields nothing has set yet, in the order they are asked. */
export function missingMobileFields(given: MobileIdentityRequest): (keyof MobileIdentity)[] {
  return MOBILE_IDENTITY_FIELDS.filter((field) => given[field] === undefined);
}

/**
 * Asks for each field a flag or the config file left open. The default, built
 * from the project name, is shown and taken when the answer is left empty.
 */
export async function askMobileIdentity(
  defaults: MobileIdentity,
  given: MobileIdentityRequest,
): Promise<MobileIdentityRequest | typeof CANCELLED> {
  const answers: MobileIdentityRequest = {};
  for (const field of missingMobileFields(given)) {
    const fallback = defaults[field];
    const answer = await text({
      message: MOBILE_PROMPTS[field],
      placeholder: fallback,
      defaultValue: fallback,
      validate: (value?: string) =>
        value === undefined || value === '' ? undefined : checkMobileField(field, value),
    });
    if (isCancel(answer) || typeof answer === 'symbol') return CANCELLED;
    answers[field] = answer === '' ? fallback : answer;
  }
  return answers;
}
