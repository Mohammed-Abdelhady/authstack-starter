import { describe, expect, it } from 'vitest';
import { stripHashMarkers, takesHashMarkers } from '../../src/prune/hash-markers.js';

const KNOWN = new Set(['mongodb', 'postgres', 'docker']);
const strip = (content: string, kept: string[]): string =>
  stripHashMarkers(content, 'ci.yml', new Set(kept), KNOWN).content;

describe('markers in files whose comments start with a hash', () => {
  const workflow = [
    'steps:',
    '  # feature:mongodb:start',
    '  - name: Cache the database binary',
    '    run: cache',
    '  # feature:mongodb:end',
    '  - name: Install',
    '    env:',
    '      DATABASE: second # feature:postgres',
    '      NODE_ENV: test',
  ].join('\n');

  it('removes a block and a marked line of what was left out, and only the comments of what stays', () => {
    expect({
      mongodb: strip(workflow, ['mongodb']),
      postgres: strip(workflow, ['postgres']),
    }).toEqual({
      mongodb: [
        'steps:',
        '  - name: Cache the database binary',
        '    run: cache',
        '  - name: Install',
        '    env:',
        '      NODE_ENV: test',
      ].join('\n'),
      postgres: [
        'steps:',
        '  - name: Install',
        '    env:',
        '      DATABASE: second',
        '      NODE_ENV: test',
      ].join('\n'),
    });
  });

  it('leaves a file without a marker exactly as it was', () => {
    const plain = '# a comment about features\nkey: value # trailing\n';

    expect(strip(plain, [])).toBe(plain);
  });

  it.each([
    [
      'an id the manifest does not list',
      'key: value # feature:mysql',
      /"mysql", which the manifest does not list/,
    ],
    [
      'a block that never closes',
      '# feature:docker:start\nkey: value',
      /opens docker and never closes it/,
    ],
    [
      'a block marker on a line with text',
      'key: value # feature:docker:start',
      /start marker on a line with other text/,
    ],
    [
      'a marker that is not at the end of its line',
      '# feature:docker and more text',
      /malformed hash marker/,
    ],
  ])('refuses %s and names the file and line', (_, content, problem) => {
    expect(() => strip(content, ['docker'])).toThrow(problem);
    expect(() => strip(content, ['docker'])).toThrow(/^ci\.yml:\d+ /);
  });

  it('reads YAML, shell, Dockerfiles and ignore files, and nothing else', () => {
    const files = [
      '.github/workflows/ci.yml',
      'docker-compose.yaml',
      'nginx/ssl-setup.sh',
      'backend/Dockerfile',
      '.dockerignore',
      'frontend/.gitignore',
      'README.md',
      'scripts/init.js',
      'backend/Dockerfile.md',
      '.env.example',
    ];

    expect(files.filter(takesHashMarkers)).toEqual([
      '.github/workflows/ci.yml',
      'docker-compose.yaml',
      'nginx/ssl-setup.sh',
      'backend/Dockerfile',
      '.dockerignore',
      'frontend/.gitignore',
    ]);
  });
});
