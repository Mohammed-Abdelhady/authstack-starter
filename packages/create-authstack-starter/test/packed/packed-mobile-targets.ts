import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCKER_API_ORIGIN,
  MOBILE_API_ORIGIN_VAR,
  MOBILE_RUN_COMMAND,
} from '../../src/constants/mobile.js';
import { nativeRegistration } from '../../src/mobile/apply.js';
import { MOBILE_PROOF_TEXT } from '../../src/scaffold/rules-text-template.js';
import {
  expectEngineSuitesStayInRepository,
  expectExpoWorkspace,
  expectNoMobileWorkspace,
} from '../support/mobile-workspace-assertions.js';
import { type Packed, scaffold, sourceFilesWithMarkers } from './packed-cli.js';

const IDENTITY = {
  name: "Sam's Trail Log",
  slug: 'trail-log',
  appId: 'org.sample.trail',
  scheme: 'org.sample.trail-log',
};
const IDENTITY_FLAGS = [
  '--mobile-name',
  IDENTITY.name,
  '--mobile-slug',
  IDENTITY.slug,
  '--mobile-app-id',
  IDENTITY.appId,
  '--mobile-scheme',
  IDENTITY.scheme,
];
const REGISTRATION = `AUTH_NATIVE_APPLICATIONS=${nativeRegistration(IDENTITY)}`;
/** The identity this repository ships, which a generated app must not keep. */
const TEMPLATE_IDENTITY = /com\.example\.mobile|Mobile Expo|"mobile-expo"|Example Mobile/;

function read(project: string, path: string): string {
  return readFileSync(join(project, path), 'utf8');
}

function generate(packed: Packed, name: string, flags: string[]): string {
  const result = scaffold(packed, name, 'email-password', { flags });
  // A leftover import into a removed folder fails the run, so exit 0 is the reference check.
  expect(result.status, `${String(result.stdout)}\n${String(result.stderr)}`).toBe(0);
  expect(String(result.stdout)).not.toContain('still references files that were removed');
  return join(packed.workspace, name);
}

function mobileDocs(project: string): Record<string, boolean> {
  const readme = read(project, 'README.md');
  const agents = read(project, 'AGENTS.md');
  return {
    readmeRuns: readme.includes(MOBILE_RUN_COMMAND),
    readmeIdentity: readme.includes('mobile/expo/app.json'),
    readmeAndroid: /Android has not been built or run/.test(readme),
    readmeProof: readme.includes(MOBILE_PROOF_TEXT),
    agentsRuns: agents.includes(MOBILE_RUN_COMMAND),
    agentsAndroid: /Android has not been built or run/.test(agents),
    agentsProof: agents.includes(MOBILE_PROOF_TEXT),
    agentsScope: /^- Scopes: .*\bmobile\b/m.test(agents),
  };
}

/** What the README tells the reader to set on the server before the app can sign in. */
const SERVER_VARIABLES = [
  'AUTH_NATIVE_ENABLED',
  'AUTH_NATIVE_DPOP_NONCE_SECRET',
  'API_URL',
  'AUTH_NATIVE_APPLICATIONS',
];
const WORKSPACE_FOLDERS: Record<string, string> = {
  backend: 'backend',
  frontend: 'frontend',
  '@app/mobile-expo': 'mobile/expo',
};
const FILTERED_COMMAND = /pnpm --filter (\S+) run ([\w:-]+)/g;
const DOCKER_RUN = `${MOBILE_API_ORIGIN_VAR}=${DOCKER_API_ORIGIN} ${MOBILE_RUN_COMMAND}`;

/** Commands in the README that name a workspace or a script the project does not have. */
function commandsThatDoNotExist(project: string): string[] {
  const missing: string[] = [];
  for (const [command, workspace, script] of read(project, 'README.md').matchAll(
    FILTERED_COMMAND,
  )) {
    const folder = WORKSPACE_FOLDERS[workspace];
    const scripts =
      folder === undefined
        ? {}
        : (JSON.parse(read(project, `${folder}/package.json`)) as { scripts: object }).scripts;
    if (!Object.hasOwn(scripts, script)) missing.push(command);
  }
  return missing;
}

/** Server variables the README names that an example file neither sets nor shows commented out. */
function variablesMissingFrom(project: string, example: string): string[] {
  const readme = read(project, 'README.md');
  const content = read(project, example);
  return SERVER_VARIABLES.filter(
    (name) => !readme.includes(`\`${name}`) || !new RegExp(`^(?:# )?${name}=`, 'm').test(content),
  );
}

export function mobileTargetCases(getPacked: () => Packed): void {
  describe('the clients a project is generated with', () => {
    it('leaves a web project with no mobile workspace and no word about one', () => {
      const project = generate(getPacked(), 'clients-web', ['--targets', 'web']);

      expectNoMobileWorkspace(project);
      expectEngineSuitesStayInRepository(project);
      expect(mobileDocs(project)).toEqual({
        readmeRuns: false,
        readmeIdentity: false,
        readmeAndroid: false,
        readmeProof: false,
        agentsRuns: false,
        agentsAndroid: false,
        agentsProof: false,
        agentsScope: false,
      });
      expect(read(project, 'README.md')).not.toMatch(/mobile app/i);
      expect(read(project, 'AGENTS.md')).not.toMatch(/\bmobile\b/i);
      expect(read(project, 'backend/.env.example')).toContain('# AUTH_NATIVE_APPLICATIONS=');
      expect(sourceFilesWithMarkers(project)).toEqual([]);
    });

    it.each([
      ['web and the Expo app', 'clients-both', 'web,native-expo', ['native-expo', 'web']],
      ['the Expo app alone', 'clients-expo', 'native-expo', ['native-expo']],
    ])('keeps the Expo app and the sign-in site for %s', (_label, name, targets, recorded) => {
      const project = generate(getPacked(), name, ['--targets', targets, ...IDENTITY_FLAGS]);

      expectExpoWorkspace(project);
      for (const file of [
        'mobile/adapters/package.json',
        'mobile/auth/package.json',
        'mobile/device-key/package.json',
        'mobile/expo/package.json',
        'mobile/metro/package.json',
        'mobile/ui/package.json',
      ]) {
        const manifest = JSON.parse(read(project, file)) as { engines: Record<string, string> };
        expect(manifest.engines, file).toEqual({ node: '^22.12.0 || ^24.22.0', pnpm: '12.6.0' });
      }
      expectEngineSuitesStayInRepository(project);
      expect(sourceFilesWithMarkers(project)).toEqual([]);
      expect(read(project, 'README.md')).not.toContain('feature:');
      expect(mobileDocs(project)).toEqual({
        readmeRuns: true,
        readmeIdentity: true,
        readmeAndroid: true,
        readmeProof: true,
        agentsRuns: true,
        agentsAndroid: true,
        agentsProof: true,
        agentsScope: true,
      });
      expect({
        commands: commandsThatDoNotExist(project),
        backendExample: variablesMissingFrom(project, 'backend/.env.example'),
        dockerExample: variablesMissingFrom(project, '.env.docker.example'),
        dockerRun: read(project, 'README.md').includes(DOCKER_RUN),
      }).toEqual({ commands: [], backendExample: [], dockerExample: [], dockerRun: true });
      const answers = JSON.parse(read(project, '.create-authstack-starter.json')) as {
        answers: { targets: string[] };
      };
      expect(answers.answers.targets).toEqual(recorded);
    });

    it('writes the identity into the app config and the server examples, and nowhere twice', () => {
      const project = generate(getPacked(), 'clients-identity', [
        '--targets',
        'web,native-expo',
        ...IDENTITY_FLAGS,
      ]);

      const app = JSON.parse(read(project, 'mobile/expo/app.json')) as {
        expo: {
          name: string;
          slug: string;
          scheme: string;
          ios: { bundleIdentifier: string };
          android: { package: string };
        };
      };
      expect({
        name: app.expo.name,
        slug: app.expo.slug,
        scheme: app.expo.scheme,
        ios: app.expo.ios.bundleIdentifier,
        android: app.expo.android.package,
      }).toEqual({
        name: "Sam's Trail Log",
        slug: 'trail-log',
        scheme: 'org.sample.trail-log',
        ios: 'org.sample.trail',
        android: 'org.sample.trail',
      });
      for (const file of ['backend/.env.example', '.env.docker.example', 'backend/README.md']) {
        expect(read(project, file).split('\n'), file).toContain(REGISTRATION);
      }
      const leftovers = [
        'mobile/expo/app.json',
        'mobile/expo/src/config.ts',
        'mobile/expo/src/logic/resolve-config.ts',
        'backend/.env.example',
        '.env.docker.example',
        'backend/README.md',
        'README.md',
        'AGENTS.md',
      ].filter((file) => TEMPLATE_IDENTITY.test(read(project, file)));
      expect(leftovers).toEqual([]);
      // The app reads its scheme from app.json, so no source file repeats it.
      const copies = [
        'mobile/expo/src/config.ts',
        'mobile/expo/src/logic/resolve-config.ts',
      ].filter((file) => read(project, file).includes(IDENTITY.scheme));
      expect(copies).toEqual([]);
    });

    it('refuses the bare app and writes nothing', () => {
      const packed = getPacked();
      const result = scaffold(packed, 'clients-bare', 'email-password', {
        flags: ['--targets', 'web,native-cli'],
      });

      expect(result.status).toBe(2);
      expect(String(result.stdout)).toContain('"native-cli" is not available yet.');
      expect(existsSync(join(packed.workspace, 'clients-bare'))).toBe(false);
    });
  });
}
