import { describe, expect, it } from 'vitest';
import { locksPackage } from '../support/lockfile-lines.js';

describe('a lockfile line that resolves a package', () => {
  const lines = [
    "  '@types/pg@8.11.0':",
    "      '@types/pg':",
    '  pg@8.13.0:',
    '      pg:',
    '  pg-protocol@1.7.0:',
    "  '@types/pgvector@1.0.0':",
    '        specifier: ^8.13.0',
  ];

  it('is told for a quoted scoped name, as a package entry and as an importer entry', () => {
    expect(lines.filter((line) => locksPackage(line, '@types/pg'))).toEqual([
      "  '@types/pg@8.11.0':",
      "      '@types/pg':",
    ]);
  });

  it('is told for a plain name, and not for a longer name that starts the same', () => {
    expect(lines.filter((line) => locksPackage(line, 'pg'))).toEqual(['  pg@8.13.0:', '      pg:']);
  });
});
