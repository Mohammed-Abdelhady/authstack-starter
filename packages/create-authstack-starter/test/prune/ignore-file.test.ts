import { describe, expect, it } from 'vitest';
import { pruneIgnoreEntries, removedFolders } from '../../src/prune/ignore-file.js';

describe('removedFolders', () => {
  it('reads the folder a whole-tree glob takes away', () => {
    expect(removedFolders(['mobile/expo/**', 'mobile/cli/**'])).toEqual([
      'mobile/expo',
      'mobile/cli',
    ]);
  });

  it('ignores single files and globs with a wildcard in the folder', () => {
    expect(removedFolders(['kiosk.env.example', 'mobile/*/ios/**', 'docs/a.md'])).toEqual([]);
  });
});

describe('pruneIgnoreEntries', () => {
  const content = [
    '# Dependencies',
    'node_modules/',
    '',
    '# Native projects Expo generates',
    'mobile/expo/ios/',
    '/mobile/expo/android/',
    '',
    '# Mixed',
    'mobile/expo/.expo/',
    'coverage/',
    '',
    '!docs/',
    '',
  ].join('\n');

  it('drops the entries inside a removed folder and the comment left with none', () => {
    expect(pruneIgnoreEntries(content, ['mobile/expo'])).toBe(
      ['# Dependencies', 'node_modules/', '', '# Mixed', 'coverage/', '', '!docs/', ''].join('\n'),
    );
  });

  it('keeps an entry in a folder that only starts with the same letters', () => {
    expect(pruneIgnoreEntries('mobile/expo-notes/\nmobile/expo/ios/\n', ['mobile/expo'])).toBe(
      'mobile/expo-notes/\n',
    );
  });

  it('returns the content untouched when no folder was removed', () => {
    expect(pruneIgnoreEntries(content, [])).toBe(content);
  });

  it('returns the content untouched when nothing sits in the removed folder', () => {
    expect(pruneIgnoreEntries(content, ['kiosk'])).toBe(content);
  });
});
