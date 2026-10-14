import type { MailMessage, PluralMessage } from '../types/mail-catalogue.types';
import { messageArguments } from './format-message';

type MessagesShape = Readonly<
  Partial<Record<string, MailMessage | PluralMessage>>
>;
/** A catalogue as the check reads it, so a broken one can be described too. */
export type CatalogueShape = Readonly<Partial<Record<string, MessagesShape>>>;

function namesOf(...records: object[]): string[] {
  return [...new Set(records.flatMap((record) => Object.keys(record)))].sort();
}

function argumentList(message: MailMessage | PluralMessage): string {
  return `{${messageArguments(message).join(', ')}}`;
}

/** The plural forms the language's rules can select that the phrase lacks. */
function missingForms(locale: string, forms: PluralMessage): string[] {
  const rules = new Intl.PluralRules(locale);
  const { pluralCategories } = rules.resolvedOptions();
  return pluralCategories.filter((category) => forms[category] === undefined);
}

function messageDifferences(
  path: string,
  reference: MailMessage | PluralMessage,
  other: MailMessage | PluralMessage,
  locale: string,
): string[] {
  const differences: string[] = [];
  if (argumentList(reference) !== argumentList(other)) {
    differences.push(
      `${path}: arguments ${argumentList(other)}, expected ${argumentList(reference)}`,
    );
  }
  if (typeof reference !== typeof other) {
    differences.push(`${path}: counted in one language only`);
  } else if (typeof other !== 'string') {
    for (const form of missingForms(locale, other)) {
      differences.push(`${path}: no "${form}" form`);
    }
  }
  return differences;
}

/**
 * What `other`, in `locale`, lacks or adds against `reference`: a mail, a key,
 * an argument, or a plural form its language selects. Empty when they match.
 */
export function catalogueDifferences(
  reference: CatalogueShape,
  other: CatalogueShape,
  locale: string,
): string[] {
  const differences: string[] = [];
  for (const mail of namesOf(reference, other)) {
    const referenceMail = reference[mail] ?? {};
    const otherMail = other[mail] ?? {};
    for (const key of namesOf(referenceMail, otherMail)) {
      const path = `${mail}.${key}`;
      const referenceMessage = referenceMail[key];
      const otherMessage = otherMail[key];
      if (referenceMessage === undefined) {
        differences.push(`${path}: not in the reference language`);
      } else if (otherMessage === undefined) {
        differences.push(`${path}: missing`);
      } else {
        differences.push(
          ...messageDifferences(path, referenceMessage, otherMessage, locale),
        );
      }
    }
  }
  return differences;
}
