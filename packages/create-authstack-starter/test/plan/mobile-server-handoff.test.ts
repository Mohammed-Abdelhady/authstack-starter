import { describe, expect, it } from 'vitest';
import { parseNativeApplications } from '../../../../backend/src/config/utils/native-application-config.util';
import * as serverClientIds from '../../../../backend/src/session/constants/client-ids';
import { nativeRegistration } from '../../src/mobile/apply.js';
import { checkMobileField, defaultMobileIdentity } from '../../src/mobile/identity.js';
import type { MobileIdentity } from '../../src/types/mobile.js';

const NOTES: MobileIdentity = {
  name: `Sam's "Notes"`,
  slug: 'field-notes',
  appId: 'org.sample.notes',
  scheme: 'org.sample.notes-app',
};
const SCHEME_AT_LIMIT = `a${'b'.repeat(127)}`;
/** The two ways the server reads the value: a development run, and production with custom schemes on. */
const POLICIES = [{ nodeEnv: 'development' }, { nodeEnv: 'production', allowCustomScheme: true }];

/** The value as the server sees it once the env file's single quotes are taken off. */
function envValue(quoted: string): string {
  if (!quoted.startsWith("'") || !quoted.endsWith("'")) {
    throw new Error('The registration is not a single quoted value.');
  }
  return quoted.slice(1, -1);
}

function serverReads(identity: MobileIdentity, policy = POLICIES[0]): unknown {
  return parseNativeApplications(envValue(nativeRegistration(identity)), policy);
}

function serverAccepts(identity: MobileIdentity): boolean {
  try {
    for (const policy of POLICIES) serverReads(identity, policy);
    return true;
  } catch {
    return false;
  }
}

/** Every string the server's client id constants hold, at any depth. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || value instanceof RegExp) return [];
  return Object.values(value).flatMap(strings);
}

describe("the installer's registration read by the server", () => {
  it('is accepted as the app it names', () => {
    expect(serverReads(NOTES)).toEqual([
      {
        clientId: 'org.sample.notes-app',
        displayName: `Sam's "Notes"`,
        redirectUris: ['org.sample.notes-app://oauth/callback'],
        allowedScopes: ['api'],
      },
    ]);
  });

  it.each(['my-app', 'web', 'admin', '123go', '---'])(
    'is accepted with the defaults built from the project name %j',
    (projectName) => {
      expect(serverAccepts(defaultMobileIdentity(projectName))).toBe(true);
    },
  );

  it.each(['web', 'admin'])(
    'is refused by both sides when the scheme is the client id %j',
    (scheme) => {
      expect(serverAccepts({ ...NOTES, scheme })).toBe(false);
      expect(typeof checkMobileField('scheme', scheme)).toBe('string');
    },
  );

  it('never passes a scheme the server then refuses as a client id', () => {
    const fromServer = strings(serverClientIds);
    const candidates = new Set([
      ...fromServer,
      ...fromServer.map((value) => value.toLowerCase()),
      'a',
      'webx',
      'administrator',
      'native',
      'com.example.my-app2',
      SCHEME_AT_LIMIT,
    ]);

    const passedThenRefused = [...candidates].filter(
      (scheme) =>
        checkMobileField('scheme', scheme) === undefined && !serverAccepts({ ...NOTES, scheme }),
    );

    // The sweep reads the server's own constants, so it has to have found the two reserved ids.
    expect(fromServer).toEqual(expect.arrayContaining(['web', 'admin']));
    expect(passedThenRefused).toEqual([]);
  });

  it.each([
    'A',
    "Sam's Notes",
    'Notes "Pro" & <More>',
    'ملاحظات',
    'Abcdefghij Abcdefghij Abcdefgh',
  ])('is accepted with the name %j, which the installer accepts', (name) => {
    expect(checkMobileField('name', name)).toBeUndefined();
    expect(serverAccepts({ ...NOTES, name })).toBe(true);
  });
});
