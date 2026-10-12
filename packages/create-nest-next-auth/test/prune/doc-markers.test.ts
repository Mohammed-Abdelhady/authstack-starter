import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DocMarkerError, removeDocMarkers, stripDocMarkers } from '../../src/prune/doc-markers.js';

const KNOWN = new Set(['docker', 'production', 'locale-ar']);

function strip(lines: string[], kept: string[], file = 'README.md'): string {
  return stripDocMarkers(lines.join('\n'), file, new Set(kept), KNOWN).content;
}

const roots: string[] = [];

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-doc-markers-'));
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

describe('stripDocMarkers', () => {
  it('removes a whole section for an option that was not selected', () => {
    const source = [
      '# Project',
      '<!-- feature:docker:start -->',
      '### Start with Docker',
      '```bash',
      'docker compose up',
      '```',
      '<!-- feature:docker:end -->',
      '### Start manually',
    ];

    expect(strip(source, ['production'])).toBe('# Project\n### Start manually');
  });

  it('keeps the section and drops only the marker lines when selected', () => {
    const source = [
      '<!-- feature:docker:start -->',
      'docker compose up',
      '<!-- feature:docker:end -->',
    ];

    expect(strip(source, ['docker'])).toBe('docker compose up');
  });

  it('takes a line marker off when kept and removes the line when not', () => {
    const source = ['A note about Compose. <!-- feature:docker -->'];

    expect(strip(source, ['docker'])).toBe('A note about Compose.');
    expect(strip(source, ['production'])).toBe('');
  });

  it('rejects an id the manifest does not list', () => {
    expect(() => strip(['<!-- feature:bogus -->'], [])).toThrow(DocMarkerError);
    expect(() => strip(['<!-- feature:bogus -->'], [])).toThrow(/README.md:1 marks "bogus"/);
  });

  it('rejects a block that is never closed', () => {
    expect(() => strip(['<!-- feature:docker:start -->', 'content'], ['docker'])).toThrow(
      /opens docker and never closes it/,
    );
  });

  it('rejects an end that closes a different block', () => {
    const source = ['<!-- feature:docker:start -->', 'content', '<!-- feature:production:end -->'];
    expect(() => strip(source, ['docker'])).toThrow(/closes production while docker is open/);
  });

  it('rejects a marker that is not alone at the end of its line', () => {
    expect(() => strip(['<!-- feature:docker --> trailing text'], ['docker'])).toThrow(
      /not alone at the end of its line/,
    );
  });

  it('ignores marker text inside a fenced code block', () => {
    const source = ['```', '<!-- feature:docker:start -->', '```'];

    expect(strip(source, [])).toBe(source.join('\n'));
  });

  it('handles a block nested inside another block', () => {
    const source = [
      '<!-- feature:docker:start -->',
      'outer',
      '<!-- feature:production:start -->',
      'inner',
      '<!-- feature:production:end -->',
      '<!-- feature:docker:end -->',
      'tail',
    ];

    expect(strip(source, ['docker'])).toBe('outer\ntail');
    expect(strip(source, ['docker', 'production'])).toBe('outer\ninner\ntail');
    expect(strip(source, [])).toBe('tail');
  });

  it('preserves CRLF while stripping a kept marker', () => {
    const source = '<!-- feature:docker:start -->\r\nkept\r\n<!-- feature:docker:end -->\r\n';

    expect(stripDocMarkers(source, 'README.md', new Set(['docker']), KNOWN).content).toBe(
      'kept\r\n',
    );
  });
});

describe('removeDocMarkers', () => {
  it('edits marked markdown and leaves code and json alone', async () => {
    const root = await tree({
      'README.md': [
        '# Project',
        '<!-- feature:docker:start -->',
        'Compose.',
        '<!-- feature:docker:end -->',
        '',
      ].join('\n'),
      'docs/guide.md': '# Guide\n',
      'src/config.ts': 'export const a = 1; // feature:docker\n',
      'config.json': '{ "note": "feature:docker" }\n',
    });

    const result = await removeDocMarkers(root, ['production'], ['docker', 'production']);

    expect(result.editedFiles).toEqual(['README.md']);
    expect(result.removedLines).toBe(3);
    expect(await readFile(join(root, 'README.md'), 'utf8')).toBe('# Project\n');
    expect(await readFile(join(root, 'docs/guide.md'), 'utf8')).toBe('# Guide\n');
    expect(await readFile(join(root, 'src/config.ts'), 'utf8')).toBe(
      'export const a = 1; // feature:docker\n',
    );
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe(
      '{ "note": "feature:docker" }\n',
    );
  });
});
