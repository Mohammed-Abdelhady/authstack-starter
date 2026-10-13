import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MOBILE_RUN_COMMAND } from '../../src/constants/mobile.js';
import { mobileAppSection } from '../../src/scaffold/rules-text-facts.js';
import { MOBILE_APP_TEXT } from '../../src/scaffold/rules-text-template.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function project(withApp: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cna-rules-mobile-'));
  roots.push(root);
  if (withApp) {
    await mkdir(join(root, 'mobile/expo'), { recursive: true });
    await writeFile(join(root, 'mobile/expo/app.json'), '{"expo":{}}\n');
  }
  return root;
}

describe('the mobile section of the project instructions', () => {
  it('is empty for a project without the Expo app', async () => {
    expect(await mobileAppSection(await project(false))).toBe('');
  });

  it('is added, under its own heading, for a project with the Expo app', async () => {
    const section = await mobileAppSection(await project(true));

    expect(section).toBe(`\n\n${MOBILE_APP_TEXT}`);
    expect(section.split('\n')[2]).toBe('## Mobile app');
  });

  it('gives the command the next steps print, and says what was not verified', () => {
    expect(MOBILE_APP_TEXT).toContain(`\`${MOBILE_RUN_COMMAND}\``);
    expect(MOBILE_APP_TEXT).toContain('Android has not been built or run');
    for (const variable of [
      'AUTH_NATIVE_ENABLED=true',
      'AUTH_NATIVE_DPOP_NONCE_SECRET',
      'API_URL',
      'AUTH_NATIVE_APPLICATIONS',
    ]) {
      expect(MOBILE_APP_TEXT, variable).toContain(`\`${variable}\``);
    }
  });
});
