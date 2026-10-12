import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INSTALL_COMMAND } from '../constants/index.js';
import { DOCKER_API_ORIGIN, MOBILE_API_ORIGIN_VAR } from '../constants/mobile.js';
import { isRecord } from '../manifest/read.js';
import type { Manifest } from '../types.js';

export interface NextStepsInput {
  directoryLabel: string;
  installed: boolean;
  docker: boolean;
  /** The database id the project was generated for. */
  database: string;
  scripts: WorkspaceStartScripts;
  /** The command that runs the mobile app, when the project has one. */
  mobile?: string;
}

export interface WorkspaceStartScripts {
  backend: string;
  frontend: string;
}

async function workspaceScript(
  root: string,
  workspace: string,
  preferred: string,
  fallback: string,
): Promise<string> {
  const path = join(root, workspace, 'package.json');
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const scripts = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts : {};
    const name = preferred in scripts ? preferred : fallback;
    return `pnpm --filter ${workspace} run ${name}`;
  } catch {
    return `pnpm --filter ${workspace} run ${preferred}`;
  }
}

/** The commands that start each workspace, read from the generated scripts. */
export async function readWorkspaceStartScripts(root: string): Promise<WorkspaceStartScripts> {
  return {
    backend: await workspaceScript(root, 'backend', 'start:dev', 'start'),
    frontend: await workspaceScript(root, 'frontend', 'dev', 'start'),
  };
}

/** The mobile app comes last: it needs the server and the web app running first. */
function mobileSteps(command: string | undefined, docker: boolean): string[] {
  if (command === undefined) return [];
  return [
    '# Mobile app on an iOS simulator. Turn on mobile sign-in on the server first, see "Mobile app" in README.md:',
    docker ? `${MOBILE_API_ORIGIN_VAR}=${DOCKER_API_ORIGIN} ${command}` : command,
  ];
}

/** What a person runs to get a local database, by database id. */
const LOCAL_DATABASE_STEPS: Record<string, string[]> = {
  mongodb: [
    '# Start a single-node replica set (sign-in uses transactions):',
    'mkdir -p ./mongodb-data',
    'mongod --replSet rs0 --dbpath ./mongodb-data',
    '# leave mongod running, then in a second terminal:',
    'mongosh --eval "rs.initiate()"',
    '# set MONGO_URI with replicaSet=rs0 in backend/.env, then:',
  ],
  postgres: [
    '# Create a role and a database on PostgreSQL 18 or newer:',
    'createuser --pwprompt authboiler',
    'createdb --owner authboiler authboiler',
    '# set POSTGRES_URL in backend/.env to that role, password and database, then:',
    'pnpm --filter backend run migration:up',
  ],
};

/** The commands printed after a successful scaffold. */
export function buildNextSteps(input: NextStepsInput): string[] {
  const steps = [`cd ${input.directoryLabel}`];
  if (!input.installed) steps.push(INSTALL_COMMAND);
  if (input.docker) {
    steps.push('cp .env.docker.example .env.docker', 'docker compose --env-file .env.docker up -d');
    return [...steps, ...mobileSteps(input.mobile, true)];
  }
  steps.push(
    'cp backend/.env.example backend/.env',
    'cp frontend/.env.example frontend/.env.local',
    ...(LOCAL_DATABASE_STEPS[input.database] ?? []),
    input.scripts.backend,
    input.scripts.frontend,
  );
  return [...steps, ...mobileSteps(input.mobile, false)];
}

/** Docs worth reading for the features that were kept. */
export function buildDocLinks(manifest: Manifest, selected: string[]): string[] {
  const links = ['README.md', 'docs/README.md'];
  for (const id of selected) {
    links.push(...(manifest.features[id]?.docs ?? []));
  }
  return [...new Set(links)];
}
