import {
  JAVA_KEYWORDS,
  MOBILE_APP_ID_MAX_LENGTH,
  MOBILE_APP_ID_SEGMENT_PATTERN,
  MOBILE_CALLBACK_LOCATION,
  MOBILE_DEFAULT_ID_PREFIX,
  MOBILE_FALLBACK_WORD,
  MOBILE_IDENTITY_FIELDS,
  MOBILE_NAME_FORBIDDEN_CODES,
  MOBILE_NAME_LOWEST_PRINTABLE,
  MOBILE_NAME_MAX_LENGTH,
  MOBILE_SCHEME_MAX_LENGTH,
  MOBILE_SCHEME_PATTERN,
  MOBILE_SLUG_MAX_LENGTH,
  MOBILE_SLUG_PATTERN,
  RESERVED_SCHEMES,
  SERVER_CLIENT_IDS,
} from '../constants/mobile.js';
import type {
  MobileIdentity,
  MobileIdentityField,
  MobileIdentityRequest,
} from '../types/mobile.js';

export interface MobileIdentityProblem {
  field: MobileIdentityField;
  message: string;
}

function breaksTheLine(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < MOBILE_NAME_LOWEST_PRINTABLE || MOBILE_NAME_FORBIDDEN_CODES.has(code)) return true;
  }
  return false;
}

function checkName(value: string): string | undefined {
  if (value.trim().length === 0) return 'Enter a name for the app.';
  if (value !== value.trim()) return 'Remove the space before or after the name.';
  if (breaksTheLine(value)) return 'Use a name on one line, without control characters.';
  if ([...value].length > MOBILE_NAME_MAX_LENGTH) {
    return `Use ${MOBILE_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return undefined;
}

function checkSlug(value: string): string | undefined {
  if (value.length === 0) return 'Enter a slug.';
  if (value.length > MOBILE_SLUG_MAX_LENGTH) {
    return `Use ${MOBILE_SLUG_MAX_LENGTH} characters or fewer.`;
  }
  if (!MOBILE_SLUG_PATTERN.test(value)) {
    return 'Use lower case letters, digits, hyphens and underscores, starting with a letter or a digit.';
  }
  return undefined;
}

function checkAppId(value: string): string | undefined {
  if (value.length === 0) return 'Enter an application id, such as com.example.app.';
  if (value.length > MOBILE_APP_ID_MAX_LENGTH) {
    return `Use ${MOBILE_APP_ID_MAX_LENGTH} characters or fewer.`;
  }
  const parts = value.split('.');
  if (parts.length < 2)
    return 'Use at least two parts separated by a dot, such as com.example.app.';
  for (const part of parts) {
    if (!MOBILE_APP_ID_SEGMENT_PATTERN.test(part)) {
      return 'Use letters and digits in each part, starting with a letter. Android refuses a hyphen and iOS refuses an underscore.';
    }
    if (JAVA_KEYWORDS.has(part)) return `Android refuses "${part}" as a part of an application id.`;
  }
  return undefined;
}

function checkScheme(value: string): string | undefined {
  if (value.length === 0) return 'Enter a scheme, such as com.example.app.';
  if (value.length > MOBILE_SCHEME_MAX_LENGTH) {
    return `Use ${MOBILE_SCHEME_MAX_LENGTH} characters or fewer.`;
  }
  if (!MOBILE_SCHEME_PATTERN.test(value)) {
    return 'Use lower case letters, digits, dots and hyphens, starting with a letter.';
  }
  if (RESERVED_SCHEMES.has(value))
    return `"${value}" belongs to the system. Use a scheme of your own.`;
  if (SERVER_CLIENT_IDS.has(value)) {
    return `"${value}" is a client id the server keeps for itself, and the scheme is the app's client id. Use another scheme.`;
  }
  return undefined;
}

const CHECKS: Record<MobileIdentityField, (value: string) => string | undefined> = {
  name: checkName,
  slug: checkSlug,
  appId: checkAppId,
  scheme: checkScheme,
};

/** What is wrong with one value, in words for the person who typed it, or undefined. */
export function checkMobileField(field: MobileIdentityField, value: string): string | undefined {
  return CHECKS[field](value);
}

/** The words of a project name: runs of letters and digits. */
function words(projectName: string): string[] {
  return projectName.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
}

function defaultName(parts: string[]): string {
  const titled = parts.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
  return titled.slice(0, MOBILE_NAME_MAX_LENGTH).trim();
}

/** One application id part: lower case, a leading letter, and never a Java keyword. */
function defaultIdPart(parts: string[]): string {
  const joined = parts.join('').toLowerCase();
  const lettered = /^[a-z]/.test(joined) ? joined : `${MOBILE_FALLBACK_WORD}${joined}`;
  const room = MOBILE_SCHEME_MAX_LENGTH - MOBILE_DEFAULT_ID_PREFIX.length - 1;
  const part = lettered.slice(0, room);
  return JAVA_KEYWORDS.has(part) ? `${part}${MOBILE_FALLBACK_WORD}` : part;
}

/** The identity a project gets when nothing was given: every field built from its name. */
export function defaultMobileIdentity(projectName: string): MobileIdentity {
  const found = words(projectName);
  const parts = found.length > 0 ? found : [MOBILE_FALLBACK_WORD];
  const id = `${MOBILE_DEFAULT_ID_PREFIX}.${defaultIdPart(parts)}`;
  return {
    name: defaultName(parts),
    slug: parts.join('-').toLowerCase().slice(0, MOBILE_SLUG_MAX_LENGTH),
    appId: id,
    scheme: id,
  };
}

/** Defaults from the project name, with every given field checked and laid over them. */
export function resolveMobileIdentity(
  given: MobileIdentityRequest,
  projectName: string,
): { identity: MobileIdentity; problems: MobileIdentityProblem[] } {
  const identity = defaultMobileIdentity(projectName);
  const problems: MobileIdentityProblem[] = [];
  for (const field of MOBILE_IDENTITY_FIELDS) {
    const value = given[field];
    if (value === undefined) continue;
    const message = checkMobileField(field, value);
    if (message === undefined) identity[field] = value;
    else problems.push({ field, message });
  }
  return { identity, problems };
}

/** The address sign-in returns to. The app builds the same one from the same scheme. */
export function callbackAddress(scheme: string): string {
  return `${scheme}://${MOBILE_CALLBACK_LOCATION}`;
}
