import {
  DEFAULT_LOCALE,
  SupportedLocale,
} from '../../common/constants/locales';
import {
  isLinkedMailName,
  LINKED_MAIL_NAMES,
  LinkedMailName,
  MAIL_NAME,
} from '../constants/mail-names';

/** Filled with the recipient's language when a link is built. */
export const LOCALE_PLACEHOLDER = '{locale}';

const LINK_PROTOCOLS = new Set(['https:', 'http:']);

/** One template per mail that carries a link, keyed by mail name. */
export type MailLinkTemplates = Readonly<Record<LinkedMailName, string>>;

export type MailLinkTemplatesReading =
  | { templates: MailLinkTemplates | undefined; problem?: undefined }
  | { templates?: undefined; problem: string };

function templateProblem(template: unknown): string | undefined {
  if (typeof template !== 'string') {
    return 'must be a URL in a string';
  }
  if (/[{}]/.test(template.replaceAll(LOCALE_PLACEHOLDER, ''))) {
    return `may hold no placeholder but ${LOCALE_PLACEHOLDER}`;
  }
  let url: URL;
  try {
    url = new URL(template.replaceAll(LOCALE_PLACEHOLDER, DEFAULT_LOCALE));
  } catch {
    return 'must be an absolute URL';
  }
  if (!LINK_PROTOCOLS.has(url.protocol)) {
    return 'must start with https:// or http://';
  }
  return url.hash === '' ? undefined : 'must not carry a fragment';
}

function parsedObject(raw: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return { ...parsed };
}

function textAt(entries: Record<string, unknown>, name: string): string {
  const value = entries[name];
  return typeof value === 'string' ? value : '';
}

/** Every linked mail by name. A mail added to the list fails to compile here. */
function templatesFrom(entries: Record<string, unknown>): MailLinkTemplates {
  const { EMAIL_CHANGE_CODE, MAGIC_LINK } = MAIL_NAME;
  return {
    [EMAIL_CHANGE_CODE]: textAt(entries, EMAIL_CHANGE_CODE),
    [MAGIC_LINK]: textAt(entries, MAGIC_LINK),
  };
}

/**
 * Reads one link setting: a JSON object that gives every mail with a link its
 * template. Absent or blank means no templates, so each link is `CLIENT_URL`
 * plus its fixed path. A name that is not a mail with a link, a mail left
 * out, or a template that is not an http or https URL is a problem that
 * stops start-up.
 */
export function readMailLinkTemplates(
  raw: unknown,
  setting: string,
): MailLinkTemplatesReading {
  if (raw === undefined || raw === null) return { templates: undefined };
  if (typeof raw !== 'string') return { problem: `${setting} must be text` };
  if (raw.trim() === '') return { templates: undefined };

  const entries = parsedObject(raw);
  if (!entries) {
    return { problem: `${setting} must be a JSON object keyed by mail name` };
  }
  const known = LINKED_MAIL_NAMES.join(', ');
  const stranger = Object.keys(entries).find((name) => !isLinkedMailName(name));
  if (stranger !== undefined) {
    return {
      problem: `${setting} names "${stranger}", which is not a mail with a link. Mails with a link: ${known}`,
    };
  }
  for (const name of LINKED_MAIL_NAMES) {
    if (entries[name] === undefined) {
      return {
        problem: `${setting} has no template for "${name}". Set every one of: ${known}`,
      };
    }
    const problem = templateProblem(entries[name]);
    if (problem !== undefined) {
      return { problem: `${setting}.${name} ${problem}` };
    }
  }
  return { templates: templatesFrom(entries) };
}

/** The templates of a setting, or the problem with it as a thrown error. */
export function parseMailLinkTemplates(
  raw: string | undefined,
  setting: string,
): MailLinkTemplates | undefined {
  const reading = readMailLinkTemplates(raw, setting);
  if (reading.problem !== undefined) {
    throw new Error(reading.problem);
  }
  return reading.templates;
}

/**
 * The link a template gives. A template with no path, such as
 * `https://id.example.com`, takes the mail's fixed path; any other template
 * is the whole address. Query values are added to any query the template
 * already has.
 */
export function fillMailLink(
  template: string,
  path: string,
  locale: SupportedLocale,
  params: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(template.replaceAll(LOCALE_PLACEHOLDER, locale));
  if (url.pathname === '/') {
    url.pathname = path;
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
