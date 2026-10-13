const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

const ILLEGAL_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*', '/', '\\', ' ']);

const LOWEST_PRINTABLE_CODE = 32;

const MAX_LENGTH = 214;

export interface NameCheck {
  valid: boolean;
  message?: string;
}

function hasIllegalCharacter(name: string): boolean {
  for (const character of name) {
    if (ILLEGAL_CHARS.has(character)) return true;
    if ((character.codePointAt(0) ?? 0) < LOWEST_PRINTABLE_CODE) return true;
  }
  return false;
}

/** Checks the last path segment of the target, which becomes the directory name. */
export function validateProjectName(name: string): NameCheck {
  if (name.length === 0) return { valid: false, message: 'Enter a project name.' };
  if (name.length > MAX_LENGTH) {
    return { valid: false, message: `Use ${MAX_LENGTH} characters or fewer.` };
  }
  if (name === '.' || name === '..') {
    return { valid: false, message: 'Enter a name, not a relative path.' };
  }
  if (hasIllegalCharacter(name)) {
    return { valid: false, message: 'Use a name without spaces, slashes or : * ? " < > | .' };
  }
  if (name.trim() !== name || name.endsWith('.')) {
    return { valid: false, message: 'Remove the leading or trailing space or dot.' };
  }
  if (name.startsWith('.')) {
    return { valid: false, message: 'Names starting with a dot are hidden directories.' };
  }
  if (WINDOWS_RESERVED.has(name.toLowerCase())) {
    return { valid: false, message: `${name} is a reserved name on Windows.` };
  }
  return { valid: true };
}

/** Turns a directory name into something npm accepts as a package name. */
export function toPackageName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-._~]/g, '-')
    .replace(/^[-._]+/, '')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : 'app';
}
