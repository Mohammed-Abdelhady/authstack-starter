import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkerError, removeFeatureLines, stripFeatureMarkers } from '../../src/prune/markers.js';

const KNOWN = new Set(['totp', 'passkeys', 'magic-link', 'google']);

function strip(lines: string[], kept: string[], file = 'src/example.ts'): string {
  return stripFeatureMarkers(lines.join('\n'), file, new Set(kept), KNOWN).content;
}

const roots: string[] = [];

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-markers-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('stripFeatureMarkers', () => {
  it('drops a marked line for a feature that was not selected', () => {
    const source = [
      "import { one } from './one';",
      "import { two } from './two'; // feature:totp",
      'export const all = [one];',
    ];

    expect(strip(source, ['passkeys'])).toBe(
      ["import { one } from './one';", 'export const all = [one];'].join('\n'),
    );
  });

  it('takes the marker off a line that stays', () => {
    const source = ['  PasskeysModule, // feature:passkeys'];
    expect(strip(source, ['passkeys'])).toBe('  PasskeysModule,');
  });

  it('drops a line whose only content is the marker', () => {
    const source = ['const a = 1;', '// feature:totp', 'const b = 2;'];
    expect(strip(source, ['totp'])).toBe(['const a = 1;', 'const b = 2;'].join('\n'));
  });

  it('removes a whole block, marker lines included', () => {
    const source = [
      'function verify() {',
      '  // feature:passkeys:start',
      '  if (dto.passkeyResponse) {',
      '    return checkPasskey(dto);',
      '  }',
      '  // feature:passkeys:end',
      '  return checkCode(dto);',
      '}',
    ];

    expect(strip(source, ['totp'])).toBe(
      ['function verify() {', '  return checkCode(dto);', '}'].join('\n'),
    );
  });

  it('keeps a block body and drops only its marker lines when the feature stays', () => {
    const source = ['// feature:totp:start', 'const twoFactor = true;', '// feature:totp:end'];
    expect(strip(source, ['totp'])).toBe('const twoFactor = true;');
  });

  it('handles a block nested inside another block', () => {
    const source = [
      '// feature:totp:start',
      'const outer = 1;',
      '  // feature:passkeys:start',
      '  const inner = 2;',
      '  // feature:passkeys:end',
      'const after = 3;',
      '// feature:totp:end',
      'const tail = 4;',
    ];

    expect(strip(source, ['totp'])).toBe(
      ['const outer = 1;', 'const after = 3;', 'const tail = 4;'].join('\n'),
    );
    expect(strip(source, ['totp', 'passkeys'])).toBe(
      ['const outer = 1;', '  const inner = 2;', 'const after = 3;', 'const tail = 4;'].join('\n'),
    );
    expect(strip(source, ['google'])).toBe('const tail = 4;');
  });

  it('keeps a comma list when any of its ids is selected', () => {
    const source = ['const shared = true; // feature:totp,passkeys'];

    expect(strip(source, ['passkeys'])).toBe('const shared = true;');
    expect(strip(source, ['totp'])).toBe('const shared = true;');
    expect(strip(source, ['google'])).toBe('');
  });

  it('reads the JSX comment forms', () => {
    const source = [
      "import { Card } from '@/modules/passkeys'; // feature:passkeys",
      '<div>',
      '  {/* feature:totp:start */}',
      '  <TwoFactorCard />',
      '  {/* feature:totp:end */}',
      '  <PasskeysCard /> {/* feature:passkeys */}',
      '</div>',
    ];

    expect(strip(source, ['passkeys'], 'src/page.tsx')).toBe(
      ["import { Card } from '@/modules/passkeys';", '<div>', '  <PasskeysCard />', '</div>'].join(
        '\n',
      ),
    );
    expect(strip(source, ['totp'], 'src/page.tsx')).toBe(
      ['<div>', '  <TwoFactorCard />', '</div>'].join('\n'),
    );
  });

  it('leaves a file without markers byte for byte alone', () => {
    const content = 'const feature = "feature:not-a-marker";\n// a plain comment\n';
    expect(stripFeatureMarkers(content, 'src/a.ts', new Set(), KNOWN).content).toBe(content);
  });

  it('rejects an id the manifest does not list', () => {
    expect(() => strip(['const a = 1; // feature:passkey'], ['passkeys'])).toThrow(MarkerError);
    expect(() => strip(['const a = 1; // feature:passkey'], ['passkeys'])).toThrow(
      /src\/example.ts:1 marks feature "passkey"/,
    );
  });

  it('rejects a malformed marker', () => {
    for (const marker of ['Totp!', '', 'totp passkeys', 'totp,,passkeys']) {
      expect(() => strip([`const a = 1; // feature:${marker}`], ['totp'])).toThrow(
        /malformed feature marker/,
      );
    }
  });

  it('preserves CRLF line endings while stripping selected markers', () => {
    const source = 'const a = 1; // feature:totp\r\nconst b = 2;\r\n';
    expect(stripFeatureMarkers(source, 'src/a.ts', new Set(['totp']), KNOWN).content).toBe(
      'const a = 1;\r\nconst b = 2;\r\n',
    );
  });

  it('rejects a block that is never closed', () => {
    expect(() => strip(['// feature:totp:start', 'const a = 1;'], ['totp'])).toThrow(
      /opens totp and never closes it/,
    );
  });

  it('rejects an end that closes a different block', () => {
    const source = ['// feature:totp:start', 'const a = 1;', '// feature:passkeys:end'];
    expect(() => strip(source, ['totp'])).toThrow(/closes passkeys while totp is open/);
  });

  it('rejects a block marker sharing a line with code', () => {
    expect(() => strip(['const a = 1; // feature:totp:start'], ['totp'])).toThrow(
      /start marker on a line that also carries code/,
    );
  });

  it('rejects a bare block comment marker left in the file', () => {
    expect(() => strip(['const a = 1;', '/* feature:totp */'], ['totp'])).toThrow(
      /src\/example\.ts:2 has a feature marker that is not alone at the end of its line/,
    );
  });

  it('handles every selection through three nested feature blocks', () => {
    const ids = ['totp', 'passkeys', 'magic-link'];
    const source = [
      '// feature:totp:start',
      'outer',
      '// feature:passkeys:start',
      'middle',
      '// feature:magic-link:start',
      'inner',
      '// feature:magic-link:end',
      '// feature:passkeys:end',
      'after',
      '// feature:totp:end',
      'tail',
    ];

    for (let mask = 0; mask < 8; mask += 1) {
      const kept = ids.filter((_, index) => (mask & (1 << index)) !== 0);
      const expected: string[] = [];
      if (kept.includes('totp')) {
        expected.push('outer');
        if (kept.includes('passkeys')) {
          expected.push('middle');
          if (kept.includes('magic-link')) expected.push('inner');
        }
        expected.push('after');
      }
      expected.push('tail');
      expect(strip(source, kept)).toBe(expected.join('\n'));
    }
  });

  it('rejects malformed nesting even inside a removed block', () => {
    expect(() => strip(['// feature:totp:end'], [])).toThrow(/never opened/);
    expect(() => strip(['// feature:totp:start', '// feature:missing:start'], [])).toThrow(
      /marks feature "missing"/,
    );
  });

  it('handles deeply nested blocks without recursive traversal', () => {
    const depth = 5000;
    const source = [
      ...Array<string>(depth).fill('// feature:totp:start'),
      'inside',
      ...Array<string>(depth).fill('// feature:totp:end'),
      'outside',
    ];
    expect(strip(source, ['totp'])).toBe('inside\noutside');
    expect(strip(source, [])).toBe('outside');
  });
});

describe('removeFeatureLines', () => {
  it('edits source files and leaves json and markdown alone', async () => {
    const root = await tree({
      'src/registry.ts': ['export const all = [', '  totp, // feature:totp', '];', ''].join('\n'),
      'docs/guide.md': '- totp // feature:totp\n',
      'config.json': '{ "note": "feature:totp" }\n',
      'src/plain.ts': 'export const one = 1;\n',
    });

    const result = await removeFeatureLines(root, ['passkeys'], [...KNOWN]);

    expect(result.editedFiles).toEqual(['src/registry.ts']);
    expect(result.removedLines).toBe(1);
    expect(await readFile(join(root, 'src/registry.ts'), 'utf8')).toBe(
      'export const all = [\n];\n',
    );
    expect(await readFile(join(root, 'docs/guide.md'), 'utf8')).toBe('- totp // feature:totp\n');
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe('{ "note": "feature:totp" }\n');
    expect(await readFile(join(root, 'src/plain.ts'), 'utf8')).toBe('export const one = 1;\n');
  });

  it('strips the markers of selected features so the output carries none', async () => {
    const root = await tree({
      'src/app.module.mjs': ['export const modules = [', '  Totp, // feature:totp', '];', ''].join(
        '\n',
      ),
    });

    await removeFeatureLines(root, ['totp'], [...KNOWN]);

    const content = await readFile(join(root, 'src/app.module.mjs'), 'utf8');
    expect(content).toBe('export const modules = [\n  Totp,\n];\n');
    expect(content).not.toContain('feature:');
  });

  it('names the file and line when a marker is wrong', async () => {
    const root = await tree({ 'src/bad.ts': 'const a = 1; // feature:nope\n' });
    await expect(removeFeatureLines(root, ['totp'], [...KNOWN])).rejects.toThrow(
      /src\/bad.ts:1 marks feature "nope"/,
    );
  });
});
