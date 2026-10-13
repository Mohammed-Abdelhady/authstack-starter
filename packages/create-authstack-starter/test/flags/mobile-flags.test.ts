import { readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigFileError, parseConfigFile } from '../../src/flags/config-file.js';
import { parseCliOptions } from '../../src/flags/options.js';
import { toPlanRequest } from '../../src/flags/request.js';
import { fixtureRoot, run } from '../support/answers-helpers.js';

const manifestRoot = fixtureRoot();
const roots: string[] = [];
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

beforeEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });
});

afterEach(async () => {
  if (ttyDescriptor) Object.defineProperty(process.stdin, 'isTTY', ttyDescriptor);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

afterAll(async () => rm(manifestRoot, { recursive: true, force: true }));

async function emptyTarget(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-mobile-flags-'));
  roots.push(root);
  const target = join(root, name);
  await mkdir(target, { recursive: true });
  return target;
}

describe('mobile identity flags', () => {
  it('reads the four flags as typed', () => {
    const options = parseCliOptions([
      '--targets',
      'Web, Native-Expo',
      '--mobile-name',
      'Field Notes',
      '--mobile-slug',
      'field-notes',
      '--mobile-app-id',
      'org.Sample.Notes',
      '--mobile-scheme',
      'org.sample.notes',
    ]);

    expect(options.targets).toEqual(['web', 'native-expo']);
    expect(options.mobile).toEqual({
      name: 'Field Notes',
      slug: 'field-notes',
      appId: 'org.Sample.Notes',
      scheme: 'org.sample.notes',
    });
  });

  it('leaves the identity out when no flag names it', () => {
    expect(parseCliOptions(['--targets', 'web']).mobile).toBeUndefined();
  });
});

describe('mobile identity in the config file', () => {
  it('reads the mobile object', () => {
    expect(
      parseConfigFile({ targets: ['native-expo'], mobile: { name: 'Notes', scheme: 'notes' } }),
    ).toEqual({ targets: ['native-expo'], mobile: { name: 'Notes', scheme: 'notes' } });
  });

  it.each([
    [{ mobile: 'Notes' }, 'mobile must be an object with name, slug, appId and scheme'],
    [{ mobile: ['Notes'] }, 'mobile must be an object with name, slug, appId and scheme'],
    [{ mobile: { bundleId: 'a.b' } }, 'unknown key "mobile.bundleId"'],
    [{ mobile: { name: 5 } }, 'mobile.name must be a string'],
    [{ mobile: { scheme: null } }, 'mobile.scheme must be a string'],
  ])('refuses %j', (config, message) => {
    const parse = (): unknown => parseConfigFile(config);

    expect(parse).toThrow(ConfigFileError);
    expect(parse).toThrow(message);
  });

  it('takes a flag over the file field by field', () => {
    const request = toPlanRequest(parseCliOptions(['--mobile-name', 'From Flag']), {
      mobile: { name: 'From File', scheme: 'file-scheme' },
    });

    expect(request.mobile).toEqual({ name: 'From Flag', scheme: 'file-scheme' });
  });
});

describe('a run that chooses the mobile app', () => {
  it('shows the defaults built from the project name and writes nothing', async () => {
    const target = await emptyTarget('field-notes');

    const { code, output } = await run(manifestRoot, [
      target,
      '--yes',
      '--dry-run',
      '--targets',
      'web,native-expo',
    ]);

    expect(code).toBe(0);
    expect(output).toContain('Mobile     Field Notes (slug field-notes)');
    expect(output).toContain('App id     com.example.fieldnotes');
    expect(output).toContain('Returns to com.example.fieldnotes://oauth/callback');
    expect(readdirSync(target)).toEqual([]);
  });

  it('shows the values the flags gave', async () => {
    const target = await emptyTarget('field-notes');

    const { code, output } = await run(manifestRoot, [
      target,
      '--yes',
      '--dry-run',
      '--targets',
      'native-expo',
      '--mobile-name',
      'Trail Log',
      '--mobile-app-id',
      'org.sample.trail',
      '--mobile-scheme',
      'trail-log',
    ]);

    expect(code).toBe(0);
    expect(output).toContain('Mobile     Trail Log (slug field-notes)');
    expect(output).toContain('App id     org.sample.trail');
    expect(output).toContain('Returns to trail-log://oauth/callback');
  });

  it.each([
    [['--mobile-scheme', 'https'], '--mobile-scheme: "https" belongs to the system.'],
    [['--mobile-app-id', 'notes'], '--mobile-app-id: Use at least two parts'],
    [['--mobile-slug', 'Field Notes'], '--mobile-slug: Use lower case letters'],
    [['--mobile-name', ''], '--mobile-name: Enter a name for the app.'],
  ])('exits 2 for %j and names the flag', async (flags, message) => {
    const target = await emptyTarget('field-notes');

    const { code, output } = await run(manifestRoot, [
      target,
      '--yes',
      '--dry-run',
      '--targets',
      'web,native-expo',
      ...flags,
    ]);

    expect(code).toBe(2);
    expect(output).toContain(message);
    expect(readdirSync(target)).toEqual([]);
  });

  it('exits 2 for an identity flag when no mobile app was chosen', async () => {
    const target = await emptyTarget('field-notes');

    const { code, output } = await run(manifestRoot, [
      target,
      '--yes',
      '--dry-run',
      '--mobile-name',
      'Notes',
    ]);

    expect(code).toBe(2);
    expect(output).toContain('--mobile-name names a mobile app, and no mobile client was chosen.');
  });

  it('refuses to guess the identity without a terminal or --yes', async () => {
    const target = await emptyTarget('field-notes');

    const { code, output } = await run(manifestRoot, [
      target,
      '--dry-run',
      '--targets',
      'web,native-expo',
      '--features',
      'email-password',
      '--no-production',
      '--rules',
      'strict',
    ]);

    expect(code).toBe(2);
    expect(output).toContain('No terminal to prompt in.');
  });

  it('runs without a terminal once every identity field is given', async () => {
    const target = await emptyTarget('field-notes');

    const { code, output } = await run(manifestRoot, [
      target,
      '--dry-run',
      '--targets',
      'web,native-expo',
      '--features',
      'email-password',
      '--no-production',
      '--rules',
      'strict',
      '--mobile-name',
      'Notes',
      '--mobile-slug',
      'notes',
      '--mobile-app-id',
      'org.sample.notes',
      '--mobile-scheme',
      'notes',
    ]);

    expect(code).toBe(0);
    expect(output).toContain('Returns to notes://oauth/callback');
  });

  it('includes the mobile app in the everything preset and leaves it out of the default', async () => {
    const everything = await run(manifestRoot, [
      await emptyTarget('all-in'),
      '--yes',
      '--dry-run',
      '--preset',
      'everything',
    ]);
    const standard = await run(manifestRoot, [await emptyTarget('plain'), '--yes', '--dry-run']);

    expect(everything.code).toBe(0);
    expect(everything.output).toContain('App id     com.example.allin');
    expect(standard.code).toBe(0);
    expect(standard.output).not.toContain('App id');
  });
});
