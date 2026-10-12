import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DOCKER_API_ORIGIN } from '../../src/constants/mobile.js';
import { isRecord } from '../../src/manifest/read.js';
import { buildNextSteps, readWorkspaceStartScripts } from '../../src/scaffold/next-steps.js';
import { REPO_ROOT } from '../support/combination-helpers.js';

const SCRIPTS = {
  backend: 'pnpm --filter backend run start:dev',
  frontend: 'pnpm --filter frontend run dev',
};

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-next-steps-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('buildNextSteps', () => {
  it('prints only what the Docker path needs when docker is on', () => {
    expect(
      buildNextSteps({
        directoryLabel: 'app',
        installed: true,
        docker: true,
        database: 'mongodb',
        scripts: SCRIPTS,
      }),
    ).toEqual([
      'cd app',
      'cp .env.docker.example .env.docker',
      'docker compose --env-file .env.docker up -d',
    ]);
  });

  it('ends with the mobile app command, after a line that sends the reader to the server setup', () => {
    const mobile = 'pnpm --filter @app/mobile-expo run ios';

    expect(
      buildNextSteps({
        directoryLabel: 'app',
        installed: true,
        docker: false,
        database: 'mongodb',
        scripts: SCRIPTS,
        mobile,
      }).slice(-2),
    ).toEqual([
      '# Mobile app on an iOS simulator. Turn on mobile sign-in on the server first, see "Mobile app" in README.md:',
      'pnpm --filter @app/mobile-expo run ios',
    ]);
  });

  it('points the mobile app at the port Docker serves the API on', () => {
    expect(
      buildNextSteps({
        directoryLabel: 'app',
        installed: true,
        docker: true,
        database: 'mongodb',
        scripts: SCRIPTS,
        mobile: 'pnpm --filter @app/mobile-expo run ios',
      }).slice(-2),
    ).toEqual([
      '# Mobile app on an iOS simulator. Turn on mobile sign-in on the server first, see "Mobile app" in README.md:',
      'EXPO_PUBLIC_API_ORIGIN=http://localhost:5000 pnpm --filter @app/mobile-expo run ios',
    ]);
  });

  it('names the port the Compose file publishes the API on', async () => {
    const compose: unknown = parse(await readFile(join(REPO_ROOT, 'docker-compose.yml'), 'utf8'));
    const published =
      isRecord(compose) && isRecord(compose.services) && isRecord(compose.services.backend)
        ? compose.services.backend.ports
        : undefined;

    expect(published).toEqual(['5000:5000']);
    expect(DOCKER_API_ORIGIN).toBe('http://localhost:5000');
  });

  it('prints the local replica-set path when docker is off', () => {
    expect(
      buildNextSteps({
        directoryLabel: 'app',
        installed: false,
        docker: false,
        database: 'mongodb',
        scripts: SCRIPTS,
      }),
    ).toEqual([
      'cd app',
      'pnpm install',
      'cp backend/.env.example backend/.env',
      'cp frontend/.env.example frontend/.env.local',
      '# Start a single-node replica set (sign-in uses transactions):',
      'mkdir -p ./mongodb-data',
      'mongod --replSet rs0 --dbpath ./mongodb-data',
      '# leave mongod running, then in a second terminal:',
      'mongosh --eval "rs.initiate()"',
      '# set MONGO_URI with replicaSet=rs0 in backend/.env, then:',
      'pnpm --filter backend run start:dev',
      'pnpm --filter frontend run dev',
    ]);
  });

  it('prints the PostgreSQL path, with the migrations, for a PostgreSQL project when docker is off', () => {
    expect(
      buildNextSteps({
        directoryLabel: 'app',
        installed: true,
        docker: false,
        database: 'postgres',
        scripts: SCRIPTS,
      }),
    ).toEqual([
      'cd app',
      'cp backend/.env.example backend/.env',
      'cp frontend/.env.example frontend/.env.local',
      '# Create a role and a database on PostgreSQL 18 or newer:',
      'createuser --pwprompt authboiler',
      'createdb --owner authboiler authboiler',
      '# set POSTGRES_URL in backend/.env to that role, password and database, then:',
      'pnpm --filter backend run migration:up',
      'pnpm --filter backend run start:dev',
      'pnpm --filter frontend run dev',
    ]);
  });

  it('prints the same Docker path for a PostgreSQL project, where Compose applies the migrations', () => {
    expect(
      buildNextSteps({
        directoryLabel: 'app',
        installed: true,
        docker: true,
        database: 'postgres',
        scripts: SCRIPTS,
      }),
    ).toEqual([
      'cd app',
      'cp .env.docker.example .env.docker',
      'docker compose --env-file .env.docker up -d',
    ]);
  });
});

describe('readWorkspaceStartScripts', () => {
  it('reads the start scripts from the generated workspaces', async () => {
    const root = await tempRoot();
    for (const [workspace, name] of [
      ['backend', 'start:dev'],
      ['frontend', 'dev'],
    ] as const) {
      const path = join(root, workspace, 'package.json');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ scripts: { [name]: 'run' } }), 'utf8');
    }

    await expect(readWorkspaceStartScripts(root)).resolves.toEqual(SCRIPTS);
  });

  it('uses the fallback script when the preferred one is absent', async () => {
    const root = await tempRoot();
    for (const workspace of ['backend', 'frontend'] as const) {
      const path = join(root, workspace, 'package.json');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ scripts: { start: 'run' } }), 'utf8');
    }

    await expect(readWorkspaceStartScripts(root)).resolves.toEqual({
      backend: 'pnpm --filter backend run start',
      frontend: 'pnpm --filter frontend run start',
    });
  });

  it('uses the preferred name when a workspace has no package.json', async () => {
    const root = await tempRoot();

    await expect(readWorkspaceStartScripts(root)).resolves.toEqual(SCRIPTS);
  });
});
