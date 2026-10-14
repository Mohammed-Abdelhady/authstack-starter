/** A sentence whose `{name}` placeholders are filled when a mail is built. */
export type MailMessage = string;

/**
 * The forms of one counted phrase, by CLDR plural category. `other` is always
 * present; a language lists every category its plural rules select.
 */
export type PluralMessage = Readonly<
  Partial<Record<Intl.LDMLPluralRule, string>>
> & { readonly other: string };

/** The messages of one mail, or of the parts every mail shares, in one language. */
export type MailMessages = Readonly<
  Record<string, MailMessage | PluralMessage>
>;

/** The shape another language must give the English messages of a mail. */
export type MessagesOf<T> = {
  readonly [K in keyof T]: T[K] extends string ? MailMessage : PluralMessage;
};

export type TextDirection = 'ltr' | 'rtl';

/** What a builder hands the transport, without the recipient. */
export interface MailContent {
  subject: string;
  /** Omitted by a mail that is sent as plain text only. */
  html?: string;
  text: string;
}
