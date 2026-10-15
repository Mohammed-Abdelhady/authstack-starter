const GLOBAL_PREFIX = /setGlobalPrefix\(\s*([^,]+),\s*\{\s*exclude:\s*\[([^\]]*)\]/;
const STRING_CONSTANT = /export const (\w+) = '([^']*)';/g;

/** Reads the shared prefix and exclusions without executing server configuration. */
export function globalPrefix(source, constantsSource = '') {
  const match = GLOBAL_PREFIX.exec(source);
  if (!match) throw new Error('the global prefix call was not found');
  const constants = new Map(
    [...constantsSource.matchAll(STRING_CONSTANT)].map(([, name, value]) => [name, value]),
  );
  const literal = (raw) => {
    const token = raw.trim();
    if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
    if (constants.has(token)) return constants.get(token);
    throw new Error(`the global prefix constant ${token} was not found`);
  };
  return {
    prefix: literal(match[1]),
    exclude: match[2]
      .split(',')
      .filter((value) => value.trim())
      .map(literal),
  };
}
