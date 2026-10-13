const SPECIAL_CHARS = /[.+^${}()|[\]\\]/g;

/**
 * Translates a posix-style glob into a RegExp. Supports `?`, `*` (one segment)
 * and `**` (any number of segments). Enough for manifest paths; no braces or
 * character classes.
 */
export function globToRegExp(glob) {
  let pattern = '';
  let index = 0;

  while (index < glob.length) {
    const char = glob[index];

    if (char === '*') {
      const isDoubleStar = glob[index + 1] === '*';
      if (isDoubleStar) {
        const skipsSlash = glob[index + 2] === '/';
        pattern += skipsSlash ? '(?:.*\\/)?' : '.*';
        index += skipsSlash ? 3 : 2;
        continue;
      }
      pattern += '[^/]*';
      index += 1;
      continue;
    }

    if (char === '?') {
      pattern += '[^/]';
      index += 1;
      continue;
    }

    pattern += char.replace(SPECIAL_CHARS, '\\$&');
    index += 1;
  }

  return new RegExp(`^${pattern}$`);
}

export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(path);
}

export function matchesAnyGlob(path, globs) {
  return globs.some((glob) => matchesGlob(path, glob));
}
