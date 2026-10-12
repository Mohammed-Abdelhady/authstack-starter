/**
 * True for a pnpm lockfile line that resolves `name`: a package entry such as
 * `  name@1.0.0:` or an importer entry such as `      name:`. A scoped name is
 * quoted in both.
 */
export function locksPackage(line: string, name: string): boolean {
  const entry = line.trim().replace(/^'(.*)':$/, '$1:');
  return entry.startsWith(`${name}@`) || entry === `${name}:`;
}
