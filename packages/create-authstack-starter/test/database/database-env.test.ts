import { afterEach, describe, expect, it } from 'vitest';
import { writeDatabaseEnvExamples } from '../../src/prune/database.js';
import { stripEnvVars } from '../../src/prune/env.js';
import { database, project, read, removeProjects } from './database-fixture.js';

afterEach(removeProjects);

describe('the settings the chosen database adds to the examples', () => {
  it('appends its lines after one blank line and skips an example that is not there', async () => {
    const root = await project({ 'backend/.env.example': 'PORT=5001\n\n\n' });

    const edited = await writeDatabaseEnvExamples(root, [
      database({
        envExamples: [
          { path: 'backend/.env.example', lines: ['# The address', 'SECOND_URL=second://host/db'] },
          { path: '.env.docker.example', lines: ['SECOND_USER=app'] },
        ],
      }),
    ]);

    expect({ edited, example: await read(root, 'backend/.env.example') }).toEqual({
      edited: ['backend/.env.example'],
      example: 'PORT=5001\n\n# The address\nSECOND_URL=second://host/db\n',
    });
  });
});

describe('a setting the example already carries for the chosen database', () => {
  it('is replaced, commented out or not, so it is never there twice', async () => {
    const root = await project({
      'backend/.env.example': 'PORT=5001\n# SECOND_URL=second://old\nSECOND_POOL=3\nCLIENT=x\n',
    });

    await writeDatabaseEnvExamples(root, [
      database({
        envExamples: [
          {
            path: 'backend/.env.example',
            lines: ['# The address', 'SECOND_URL=second://host/db', 'SECOND_POOL=10'],
          },
        ],
      }),
    ]);

    expect(await read(root, 'backend/.env.example')).toBe(
      'PORT=5001\nCLIENT=x\n\n# The address\nSECOND_URL=second://host/db\nSECOND_POOL=10\n',
    );
  });
});

describe('the settings a database that was left out loses in the examples', () => {
  const example = [
    'PORT=5001',
    '',
    '# First Connection URI',
    '# Local: first://localhost/app',
    '# Docker: first://first/app',
    'FIRST_URI=first://localhost/app',
    '',
    '# Frontend URL',
    'CLIENT_URL=http://localhost:3000',
    '',
  ].join('\n');
  const removals = new Map([['FIRST_URI', ['First', 'first']]]);

  it('takes the whole comment above a database setting, every line that names it', () => {
    expect(stripEnvVars(example, removals, new Set(['FIRST_URI']))).toEqual({
      content: 'PORT=5001\n\n# Frontend URL\nCLIENT_URL=http://localhost:3000\n',
      stripped: ['FIRST_URI'],
    });
  });

  it('takes only the nearest comment line for a setting that is not a database one', () => {
    expect(stripEnvVars(example, removals).content).toBe(
      [
        'PORT=5001',
        '',
        '# First Connection URI',
        '# Local: first://localhost/app',
        '',
        '# Frontend URL',
        'CLIENT_URL=http://localhost:3000',
        '',
      ].join('\n'),
    );
  });

  it('stops at a comment line that does not name the database', () => {
    const mixed = '# Required at start.\n# The first database.\nFIRST_URI=x\n';

    expect(stripEnvVars(mixed, removals, new Set(['FIRST_URI'])).content).toBe(
      '# Required at start.\n',
    );
  });
});
