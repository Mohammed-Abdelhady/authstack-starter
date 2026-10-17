import { afterEach, describe, expect, it } from 'vitest';
import { writeDatabaseEnvExamples } from '../../src/prune/database.js';
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
