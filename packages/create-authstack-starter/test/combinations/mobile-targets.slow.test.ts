import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { isRecord } from '../../src/manifest/read.js';
import {
  buildCli,
  type CommandResult,
  installFrozen,
  runTool,
  scaffold,
} from '../support/combination-helpers.js';
import {
  BARE_APP_REFERENCES,
  expectExpoWorkspace,
  EXPO_FOLDERS,
} from '../support/mobile-workspace-assertions.js';
import { ARABIC_FORBIDDEN, findForbiddenContent } from '../support/reference-content.js';

/**
 * Generated projects that carry the Expo app. Each one is installed from the
 * lockfile the installer wrote, then linted, typechecked, tested and bundled
 * for iOS. The cases cover default providers, password alone, Google alone,
 * and passkeys with Google. Both language choices are built.
 */
interface MobileCase {
  name: string;
  targets: string;
  features: string[] | undefined;
  flags: string[];
  /** Whether any file under `mobile/` may hold Arabic. */
  arabic: boolean;
  identity: { name: string; slug: string; appId: string; scheme: string };
}

const CASES: MobileCase[] = [
  {
    name: 'web and the Expo app',
    targets: 'web,native-expo',
    features: undefined,
    flags: [],
    arabic: true,
    identity: {
      name: 'Trail Log',
      slug: 'trail-log',
      appId: 'org.sample.trail',
      scheme: 'org.sample.trail-log',
    },
  },
  {
    name: 'the Expo app alone, in English only',
    targets: 'native-expo',
    features: ['email-password'],
    flags: ['--locales', 'en'],
    arabic: false,
    identity: {
      name: 'Field Notes',
      slug: 'field-notes',
      appId: 'org.sample.notes',
      scheme: 'fieldnotes',
    },
  },
  {
    name: 'the Expo app with Google only',
    targets: 'native-expo',
    features: ['google'],
    flags: ['--locales', 'en'],
    arabic: false,
    identity: {
      name: 'Google Field Notes',
      slug: 'google-field-notes',
      appId: 'org.sample.googlefieldnotes',
      scheme: 'googlefieldnotes',
    },
  },
  {
    name: 'the Expo app with passkeys and Google',
    targets: 'native-expo',
    features: ['passkeys', 'google'],
    flags: ['--locales', 'en'],
    arabic: false,
    identity: {
      name: 'Passkey Field Notes',
      slug: 'passkey-field-notes',
      appId: 'org.sample.passkeyfieldnotes',
      scheme: 'passkeyfieldnotes',
    },
  },
];

const EXPO_FILTER = '@app/mobile-expo';
/** Ignored by the app's own .gitignore and lint config. */
const EXPORT_FOLDER = 'dist';

let workspace = '';
let built: CommandResult = { ok: false, output: '' };

beforeAll(async () => {
  workspace = mkdtempSync(join(inject('combinationRoot'), 'mobile-'));
  built = await buildCli();
});

afterAll(() => {
  if (workspace !== '') rmSync(workspace, { recursive: true, force: true });
});

describe.each(CASES)('a generated project with $name', (mobileCase) => {
  const { name, targets, features, flags, arabic, identity } = mobileCase;
  let project = '';
  let generated: CommandResult = { ok: false, output: '' };
  let installed: CommandResult = { ok: false, output: '' };

  beforeAll(async () => {
    project = join(workspace, name.replace(/\W+/g, '-'));
    generated = await scaffold(project, features, [
      '--targets',
      targets,
      '--mobile-name',
      identity.name,
      '--mobile-slug',
      identity.slug,
      '--mobile-app-id',
      identity.appId,
      '--mobile-scheme',
      identity.scheme,
      ...flags,
    ]);
    if (generated.ok) installed = await installFrozen(project, inject('pnpmStore'));
  });

  it('is generated with no leftover reference and no word about the bare app', () => {
    expect(built.ok, built.output).toBe(true);
    expect(generated.ok, generated.output).toBe(true);
    expectExpoWorkspace(project);
  });

  it('holds Arabic in its mobile workspaces only when the project has that language', () => {
    const files = findForbiddenContent(join(project, 'mobile'), ARABIC_FORBIDDEN);

    expect(files.length > 0, files.join('\n')).toBe(arabic);
  });

  it('installs from the lockfile the installer wrote, with nothing resolved again', () => {
    expect(installed.ok, installed.output).toBe(true);
    const lockfile = readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8');
    // The lockfile holds more than one YAML document. The project's importers are in one of them.
    const importers = parseAllDocuments(lockfile).flatMap((document) => {
      const content: unknown = document.toJS();
      return isRecord(content) && isRecord(content.importers) ? Object.keys(content.importers) : [];
    });
    expect(importers.filter((path) => path.startsWith('mobile/')).sort()).toEqual(EXPO_FOLDERS);
    expect(BARE_APP_REFERENCES.some((pattern) => pattern.test(lockfile))).toBe(false);
  });

  it('retains native SDK dependencies only for selected methods', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(project, 'mobile/expo/package.json'), 'utf8'),
    );
    if (!isRecord(manifest) || !isRecord(manifest.dependencies))
      throw new Error('Expected the Expo dependency manifest');
    const dependencies = manifest.dependencies;
    const selected = new Set(features ?? ['email-password', 'google', 'github', 'facebook']);
    expect('react-native-nitro-google-signin' in dependencies).toBe(selected.has('google'));
    expect('react-native-nitro-modules' in dependencies).toBe(selected.has('google'));
    expect('react-native-fbsdk-next' in dependencies).toBe(selected.has('facebook'));
    expect('expo-apple-authentication' in dependencies).toBe(selected.has('apple'));
    expect('react-native-passkeys' in dependencies).toBe(selected.has('passkeys'));
  });

  it('lints every workspace', async () => {
    const lint = await runTool('pnpm', ['run', 'lint'], { cwd: project });
    expect(lint.ok, lint.output).toBe(true);
  });

  it('typechecks every workspace', async () => {
    const typecheck = await runTool('pnpm', ['run', 'typecheck'], { cwd: project });
    expect(typecheck.ok, typecheck.output).toBe(true);
  });

  it('passes the unit tests of the mobile workspaces', async () => {
    const tests = await runTool('pnpm', ['--filter', './mobile/*', 'run', 'test'], {
      cwd: project,
    });
    expect(tests.ok, tests.output).toBe(true);
  });

  it('gives Expo the chosen identity as its app config', async () => {
    const config = await runTool(
      'pnpm',
      ['--filter', EXPO_FILTER, 'exec', 'expo', 'config', '--json'],
      {
        cwd: project,
      },
    );
    expect(config.ok, config.output).toBe(true);
    const start = config.output.indexOf('{');
    const read = JSON.parse(config.output.slice(start, config.output.lastIndexOf('}') + 1)) as {
      name: string;
      slug: string;
      scheme: string;
      ios: { bundleIdentifier: string };
      android: { package: string };
    };

    expect({
      name: read.name,
      slug: read.slug,
      scheme: read.scheme,
      ios: read.ios.bundleIdentifier,
      android: read.android.package,
    }).toEqual({
      name: identity.name,
      slug: identity.slug,
      scheme: identity.scheme,
      ios: identity.appId,
      android: identity.appId,
    });
  });

  it('bundles the JavaScript for iOS with that identity in it', async () => {
    const exported = await runTool(
      'pnpm',
      [
        '--filter',
        EXPO_FILTER,
        'exec',
        'expo',
        'export',
        '--platform',
        'ios',
        '--no-bytecode',
        '--output-dir',
        EXPORT_FOLDER,
      ],
      { cwd: project },
    );
    expect(exported.ok, exported.output).toBe(true);

    const output = join(project, 'mobile/expo', EXPORT_FOLDER);
    const metadata = JSON.parse(readFileSync(join(output, 'metadata.json'), 'utf8')) as {
      fileMetadata: { ios: { bundle: string } };
    };
    const bundlePath = join(output, metadata.fileMetadata.ios.bundle);
    expect(statSync(bundlePath).size).toBeGreaterThan(100_000);
    const bundle = readFileSync(bundlePath, 'utf8');
    expect({
      name: bundle.includes(JSON.stringify(identity.name)),
      scheme: bundle.includes(JSON.stringify(identity.scheme)),
      appId: bundle.includes(JSON.stringify(identity.appId)),
      templateIdentity: bundle.includes('com.example.mobile'),
    }).toEqual({ name: true, scheme: true, appId: true, templateIdentity: false });
  });
});
