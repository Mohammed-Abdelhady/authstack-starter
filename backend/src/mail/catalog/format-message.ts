import type { SupportedLocale } from '../../common/constants/locales';
import type { MailMessage, PluralMessage } from '../types/mail-catalogue.types';

const ARGUMENT = /\{(\w+)\}/g;

export type MessageArguments = Readonly<Record<string, string | number>>;

/** Fills each `{name}` with its argument. A name with no argument stays as written. */
export function formatMessage(
  message: MailMessage,
  args: MessageArguments = {},
): string {
  return message.replace(ARGUMENT, (whole, name: string) => {
    const value = args[name];
    return value === undefined ? whole : String(value);
  });
}

/** The form of a counted phrase the language's plural rules pick for `count`. */
export function formatCount(
  locale: SupportedLocale,
  forms: PluralMessage,
  count: number,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  return formatMessage(forms[category] ?? forms.other, { count });
}

/** The argument names a message uses, across every form of a counted phrase. */
export function messageArguments(
  message: MailMessage | PluralMessage,
): string[] {
  const forms =
    typeof message === 'string'
      ? [message]
      : Object.values(message).filter(
          (form): form is string => form !== undefined,
        );
  const names = forms.flatMap((form) =>
    [...form.matchAll(ARGUMENT)].map((match) => match[1]),
  );
  return [...new Set(names)].sort();
}
