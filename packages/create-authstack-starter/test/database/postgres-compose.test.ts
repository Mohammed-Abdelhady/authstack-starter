import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isRecord } from '../../src/manifest/read.js';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

/** What one service of a compose file of this repository says under a key. */
function service(file: string, name: string, key: string): unknown {
  const compose: unknown = parse(readFileSync(`${REPOSITORY}${file}`, 'utf8'));
  const services = isRecord(compose) ? compose.services : undefined;
  const entry = isRecord(services) ? services[name] : undefined;
  if (!isRecord(entry)) throw new Error(`${file} has no service "${name}"`);
  return entry[key];
}

const SOURCE_MOUNT = ['./backend:/app/backend', '/app/node_modules', '/app/backend/node_modules'];

describe('the service that applies PostgreSQL migrations', () => {
  it('reads the migrations from the same source mount as the server in development', () => {
    const file = 'docker-compose.postgres.yml';

    expect({
      migrate: service(file, 'migrate', 'volumes'),
      backend: service(file, 'backend', 'volumes'),
      sameImage: [service(file, 'migrate', 'build'), service(file, 'backend', 'build')],
    }).toEqual({
      migrate: SOURCE_MOUNT,
      backend: SOURCE_MOUNT,
      sameImage: [
        { context: '.', dockerfile: 'backend/Dockerfile', target: 'development' },
        { context: '.', dockerfile: 'backend/Dockerfile', target: 'development' },
      ],
    });
  });

  it('runs from the image alone in production, as the server does', () => {
    const file = 'docker-compose.postgres.prod.yml';

    expect({
      migrate: service(file, 'migrate', 'volumes'),
      backend: service(file, 'backend', 'volumes'),
    }).toEqual({ migrate: undefined, backend: undefined });
  });
});
