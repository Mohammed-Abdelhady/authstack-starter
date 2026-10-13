import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { DocMarkerError, stripDocMarkers } from '../../src/prune/doc-markers.js';

const KNOWN = new Set(['docker', 'production', 'locale-ar']);

function strip(lines: string[], kept: string[]): string {
  return stripDocMarkers(lines.join('\n'), 'README.md', new Set(kept), KNOWN).content;
}

const HEADER = ['| Method | Guide |', '| ------ | ----- |'];

describe('a marker that fills the last cell of a table row', () => {
  it('removes the marker cell and its pipe when the feature is kept', () => {
    const source = [...HEADER, '| Compose | [guide](docker.md) | <!-- feature:docker --> |'];

    expect(strip(source, ['docker'])).toBe(
      '| Method | Guide |\n| ------ | ----- |\n| Compose | [guide](docker.md) |',
    );
  });

  it('removes the whole row when the feature is not kept', () => {
    const source = [
      ...HEADER,
      '| Compose | [guide](docker.md) | <!-- feature:docker --> |',
      '| Manual | [guide](manual.md) |',
    ];

    expect(strip(source, ['production'])).toBe(
      '| Method | Guide |\n| ------ | ----- |\n| Manual | [guide](manual.md) |',
    );
  });

  it('keeps the padding of the cells that stay and ignores padding around the marker', () => {
    const source = [...HEADER, '| Compose   | guide      | <!-- feature:docker -->     |  '];

    expect(strip(source, ['docker'])).toBe(
      '| Method | Guide |\n| ------ | ----- |\n| Compose   | guide      |',
    );
  });

  it('reads a row written without any spaces', () => {
    expect(strip([...HEADER, '|a|b|<!--feature:docker-->|'], ['docker'])).toBe(
      '| Method | Guide |\n| ------ | ----- |\n|a|b|',
    );
  });

  it('keeps a row marked with several ids while any of them is kept', () => {
    const source = [...HEADER, '| Proxy | nginx | <!-- feature:docker,production --> |'];
    const table = '| Method | Guide |\n| ------ | ----- |';

    expect(strip(source, ['production'])).toBe(`${table}\n| Proxy | nginx |`);
    expect(strip(source, ['docker'])).toBe(`${table}\n| Proxy | nginx |`);
    expect(strip(source, ['locale-ar'])).toBe(table);
  });

  it('handles an indented row and preserves CRLF', () => {
    const source = '  | A | B |\r\n  | - | - |\r\n  | a | b | <!-- feature:docker --> |\r\n';

    expect(stripDocMarkers(source, 'README.md', new Set(['docker']), KNOWN).content).toBe(
      '  | A | B |\r\n  | - | - |\r\n  | a | b |\r\n',
    );
    expect(stripDocMarkers(source, 'README.md', new Set<string>(), KNOWN).content).toBe(
      '  | A | B |\r\n  | - | - |\r\n',
    );
  });

  it('still reads a marker written after the closing pipe as a line marker', () => {
    const source = [...HEADER, '| Compose | guide | <!-- feature:docker -->'];

    expect(strip(source, ['docker'])).toBe(
      '| Method | Guide |\n| ------ | ----- |\n| Compose | guide |',
    );
    expect(strip(source, [])).toBe('| Method | Guide |\n| ------ | ----- |');
  });

  it('leaves a marked row inside a fenced code block alone', () => {
    const source = ['```md', '| a | b | <!-- feature:docker --> |', '```'];

    expect(strip(source, [])).toBe('```md\n| a | b | <!-- feature:docker --> |\n```');
  });

  it.each([
    ['in a middle cell', '| a | <!-- feature:docker --> | b |'],
    ['sharing its cell with text', '| a | note <!-- feature:docker --> |'],
    ['after an escaped pipe', '| a \\| <!-- feature:docker --> |'],
    ['as the only cell', '| <!-- feature:docker --> |'],
    [
      'next to a second marker cell',
      '| a | <!-- feature:docker --> | <!-- feature:production --> |',
    ],
  ])('rejects a marker %s', (_name, row) => {
    const attempt = (): string => strip([...HEADER, row], ['docker', 'production']);

    expect(attempt).toThrow(DocMarkerError);
    expect(attempt).toThrow(
      'README.md:3 has a doc marker that is not alone at the end of its line',
    );
  });

  it.each([
    ['a trailing cell', '| Method | Guide | <!-- feature:docker --> |'],
    ['the end of the line', '| Method | Guide | <!-- feature:docker -->'],
  ])('rejects a marker on a header row, in %s', (_name, header) => {
    const attempt = (): string => strip([header, '| ------ | ----- |', '| a | b |'], ['docker']);

    expect(attempt).toThrow(DocMarkerError);
    expect(attempt).toThrow('README.md:1 puts a doc marker on a table header row');
  });

  it.each([
    ['a trailing cell', '| ------ | ----- | <!-- feature:docker --> |'],
    ['the end of the line', '| ------ | ----- | <!-- feature:docker -->'],
  ])('rejects a marker on a separator row, in %s', (_name, separator) => {
    const attempt = (): string => strip(['| Method | Guide |', separator], ['docker']);

    expect(attempt).toThrow(DocMarkerError);
    expect(attempt).toThrow('README.md:2 puts a doc marker on a table separator row');
  });

  it('rejects a block marker and an unknown id in a cell', () => {
    expect(() => strip([...HEADER, '| a | b | <!-- feature:docker:start --> |'], [])).toThrow(
      'README.md:3 puts a start marker on a line with other text',
    );
    expect(() => strip([...HEADER, '| a | b | <!-- feature:bogus --> |'], [])).toThrow(
      'README.md:3 marks "bogus", which the manifest does not list',
    );
  });
});

describe('a marked table and the formatter', () => {
  const FORMATTED = [
    '| Method  | Guide              |',
    '| ------- | ------------------ |',
    '| Manual  | [guide](manual.md) |',
    '| Compose | [guide](docker.md) | <!-- feature:docker --> |',
    '',
  ].join('\n');

  async function prettier(content: string): Promise<string> {
    return format(content, { parser: 'markdown' });
  }

  it('is left as written by Prettier, before and after the marker is taken off', async () => {
    expect(await prettier(FORMATTED)).toBe(FORMATTED);

    const kept = stripDocMarkers(FORMATTED, 'README.md', new Set(['docker']), KNOWN).content;
    expect(kept).toBe(
      [
        '| Method  | Guide              |',
        '| ------- | ------------------ |',
        '| Manual  | [guide](manual.md) |',
        '| Compose | [guide](docker.md) |',
        '',
      ].join('\n'),
    );
    expect(await prettier(kept)).toBe(kept);
  });

  it('turns a marker written after the closing pipe into the marker cell', async () => {
    const written = FORMATTED.replace('<!-- feature:docker --> |', '<!-- feature:docker -->');

    expect(await prettier(written)).toBe(FORMATTED);
  });
});
