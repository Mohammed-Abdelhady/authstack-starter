import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { NATIVE_REGISTRATION_FILES } from '../../src/constants/mobile.js';
import {
  applyMobileIdentity,
  nativeRegistration,
  withMobileIdentity,
  withNativeRegistration,
} from '../../src/mobile/apply.js';
import type { MobileIdentity } from '../../src/types/mobile.js';
import { createTargetsTree, REGISTRATION_EXAMPLE } from '../support/targets-fixture.js';

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const NOTES: MobileIdentity = {
  name: 'Field Notes',
  slug: 'field-notes',
  appId: 'org.sample.notes',
  scheme: 'org.sample.notes-app',
};

/** A name that would break out of a quoted value if it were pasted in as it is. */
const HOSTILE: MobileIdentity = {
  ...NOTES,
  name: `Sam's "Notes" \\ $(id) \`id\` </script>`,
};

describe('withMobileIdentity', () => {
  it('sets the five identity values and keeps every other key', () => {
    const before = {
      expo: {
        name: 'Mobile Expo',
        slug: 'mobile-expo',
        version: '0.1.0',
        scheme: 'com.example.mobile',
        ios: { bundleIdentifier: 'com.example.mobileexpo', infoPlist: { Kept: true } },
        android: { package: 'com.example.mobileexpo' },
        plugins: ['expo-secure-store'],
      },
      other: 1,
    };

    expect(withMobileIdentity(before, NOTES)).toEqual({
      expo: {
        name: 'Field Notes',
        slug: 'field-notes',
        version: '0.1.0',
        scheme: 'org.sample.notes-app',
        ios: { bundleIdentifier: 'org.sample.notes', infoPlist: { Kept: true } },
        android: { package: 'org.sample.notes' },
        plugins: ['expo-secure-store'],
      },
      other: 1,
    });
    expect(before.expo.name).toBe('Mobile Expo');
  });

  it('adds the platform sections an app config does not have yet', () => {
    expect(withMobileIdentity({}, NOTES)).toEqual({
      expo: {
        name: 'Field Notes',
        slug: 'field-notes',
        scheme: 'org.sample.notes-app',
        ios: { bundleIdentifier: 'org.sample.notes' },
        android: { package: 'org.sample.notes' },
      },
    });
  });
});

describe('nativeRegistration', () => {
  it('registers the scheme as the client and its return address', () => {
    expect(nativeRegistration(NOTES)).toBe(
      `'[{"clientId":"org.sample.notes-app","displayName":"Field Notes","redirectUris":["org.sample.notes-app://oauth/callback"]}]'`,
    );
  });

  it('keeps a hostile name inside the quotes and readable as the same name', () => {
    const value = nativeRegistration(HOSTILE);
    const inner = value.slice(1, -1);

    expect(value.startsWith("'") && value.endsWith("'")).toBe(true);
    expect(inner).not.toContain("'");
    expect(inner).not.toContain('\n');
    expect((JSON.parse(inner) as { displayName: string }[])[0].displayName).toBe(HOSTILE.name);
  });

  it('reaches a shell as one argument with the name intact', () => {
    const printed = execFileSync(
      '/bin/sh',
      ['-c', `VALUE=${nativeRegistration(HOSTILE)}; printf '%s' "$VALUE"`],
      { encoding: 'utf8' },
    );

    expect((JSON.parse(printed) as { displayName: string }[])[0].displayName).toBe(HOSTILE.name);
  });
});

describe('withNativeRegistration', () => {
  it('switches a commented example on and points it at the app', () => {
    expect(withNativeRegistration(`A=1\n${REGISTRATION_EXAMPLE}\nB=2\n`, NOTES)).toEqual({
      content: `A=1\nAUTH_NATIVE_APPLICATIONS=${nativeRegistration(NOTES)}\nB=2\n`,
      replaced: 1,
    });
  });

  it('writes a name with replacement patterns in it as it is', () => {
    const identity = { ...NOTES, name: 'Notes $& $1 $$' };

    expect(withNativeRegistration(`${REGISTRATION_EXAMPLE}\n`, identity).content).toBe(
      `AUTH_NATIVE_APPLICATIONS=${nativeRegistration(identity)}\n`,
    );
  });

  it('leaves a file with no example alone and says so', () => {
    expect(withNativeRegistration('AUTH_NATIVE_ENABLED=false\n', NOTES)).toEqual({
      content: 'AUTH_NATIVE_ENABLED=false\n',
      replaced: 0,
    });
  });
});

describe('applyMobileIdentity', () => {
  it('writes the app config and every example registration, and nothing else', async () => {
    const root = await createTargetsTree();
    roots.push(root);

    const edited = await applyMobileIdentity(root, ['web', 'native-expo'], HOSTILE);

    expect(edited).toEqual(['mobile/expo/app.json', 'backend/.env.example', 'backend/README.md']);
    const app = JSON.parse(await readFile(join(root, 'mobile/expo/app.json'), 'utf8')) as {
      expo: Record<string, unknown>;
    };
    expect(app.expo).toEqual({
      name: HOSTILE.name,
      slug: 'field-notes',
      version: '0.1.0',
      scheme: 'org.sample.notes-app',
      ios: { bundleIdentifier: 'org.sample.notes', infoPlist: { Kept: true } },
      android: { package: 'org.sample.notes' },
      plugins: ['expo-secure-store'],
    });
    expect(await readFile(join(root, 'backend/.env.example'), 'utf8')).toBe(
      `AUTH_NATIVE_ENABLED=false\nAUTH_NATIVE_APPLICATIONS=${nativeRegistration(HOSTILE)}\n`,
    );
    expect(await readFile(join(root, 'backend/README.md'), 'utf8')).toBe(
      `# Backend\n\n\`\`\`bash\nAUTH_NATIVE_APPLICATIONS=${nativeRegistration(HOSTILE)}\n\`\`\`\n`,
    );
  });

  it('stops when a shipped file lost its example registration', async () => {
    const root = await createTargetsTree({ 'backend/.env.example': 'AUTH_NATIVE_ENABLED=false\n' });
    roots.push(root);

    await expect(applyMobileIdentity(root, ['native-expo'], NOTES)).rejects.toThrow(
      'backend/.env.example has no AUTH_NATIVE_APPLICATIONS example to point at the mobile app.',
    );
  });

  it('stops when the chosen app has no config to name', async () => {
    const root = await createTargetsTree();
    roots.push(root);
    await rm(join(root, 'mobile/expo/app.json'));

    await expect(applyMobileIdentity(root, ['native-expo'], NOTES)).rejects.toThrow(
      'mobile/expo/app.json is missing, so the mobile app cannot be named.',
    );
  });
});

describe('where the identity lives in this repository', () => {
  it('lists every tracked file that carries an example registration', () => {
    const tracked = execFileSync(
      'git',
      ['grep', '-l', '-I', "AUTH_NATIVE_APPLICATIONS='", '--', '.', ':!packages', ':!.hyperflow'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .sort();

    expect(tracked).toEqual([...NATIVE_REGISTRATION_FILES].sort());
  });

  it('holds the identity in app.json and in no Expo source file', async () => {
    const app = JSON.parse(await readFile(join(REPO_ROOT, 'mobile/expo/app.json'), 'utf8')) as {
      expo: { name: string; scheme: string; ios: { bundleIdentifier: string } };
    };
    const values = [app.expo.name, app.expo.scheme, app.expo.ios.bundleIdentifier];
    const sources = execFileSync('git', ['ls-files', '-z', '--', 'mobile/expo/src'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);

    const copies: string[] = [];
    for (const file of sources) {
      const content = await readFile(join(REPO_ROOT, file), 'utf8');
      if (values.some((value) => content.includes(value))) copies.push(file);
    }

    expect(values).toEqual(['Mobile Expo', 'com.example.mobile', 'com.example.mobileexpo']);
    expect(sources.length).toBeGreaterThan(10);
    expect(copies).toEqual([]);
  });
});
