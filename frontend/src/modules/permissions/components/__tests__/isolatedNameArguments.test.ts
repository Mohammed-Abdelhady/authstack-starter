import { describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/load-messages';
import { lookupMessage } from '@/i18n/__tests__/message-tree';

/** First-strong isolate and pop directional isolate, written out. */
const FIRST_STRONG = '⁨';
/** Left-to-right isolate. */
const LEFT_TO_RIGHT = '⁦';
const POP = '⁩';

/**
 * Sentences that end up in a toast or a plain heading, where no element can
 * carry `dir`. A name takes its own direction; a slug is always left to right.
 */
const ISOLATED_ARGUMENTS = [
  ['users.actions.activateSuccess', `${FIRST_STRONG}{name}${POP}`],
  ['users.actions.deactivateSuccess', `${FIRST_STRONG}{name}${POP}`],
  ['users.actions.deleteSuccess', `${FIRST_STRONG}{name}${POP}`],
  ['roles.form.editTitle', `${FIRST_STRONG}{name}${POP}`],
  ['roles.form.createSuccess', `${FIRST_STRONG}{name}${POP}`],
  ['roles.form.updateSuccess', `${FIRST_STRONG}{name}${POP}`],
  ['permissions.dialog.descriptionWithUser', `${FIRST_STRONG}{name}${POP}`],
  ['permissions.userRole.changeSuccess', `${FIRST_STRONG}{role}${POP}`],
  ['permissions.dialog.inheritedFromRole', `${LEFT_TO_RIGHT}{role}${POP}`],
] as const;

describe.each([
  'en',
  'ar', // feature:locale-ar
] as const)('names and slugs inside catalogue sentences in %s', (locale) => {
  it.each(ISOLATED_ARGUMENTS)('%s isolates its argument', async (key, isolated) => {
    const messages = await loadMessages(locale);

    expect(lookupMessage(messages, key).split(isolated)).toHaveLength(2);
  });
});
