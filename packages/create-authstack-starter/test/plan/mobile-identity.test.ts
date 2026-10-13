import { describe, expect, it } from 'vitest';
import { resolvePlan } from '../../src/manifest/plan.js';
import {
  callbackAddress,
  checkMobileField,
  defaultMobileIdentity,
  resolveMobileIdentity,
} from '../../src/mobile/identity.js';
import { describePlanErrors } from '../../src/report/summary.js';
import { TARGETS_MANIFEST } from '../support/targets-fixture.js';

const THIRTY = 'Abcdefghij Abcdefghij Abcdefgh';
const SIXTY_FOUR = 'a'.repeat(64);
// 'a.' twenty-seven times and a tail: 155 characters in all.
const APP_ID_AT_LIMIT = `${'abcd.'.repeat(30)}abcde`;
const SCHEME_AT_LIMIT = `a${'b'.repeat(127)}`;

describe('checkMobileField', () => {
  it.each([
    ['name', 'A'],
    ['name', "Sam's Notes"],
    ['name', 'Notes "Pro" & <More>'],
    ['name', 'ملاحظات'],
    ['name', THIRTY],
    ['slug', 'a'],
    ['slug', '1app'],
    ['slug', 'my-app_2'],
    ['slug', SIXTY_FOUR],
    ['appId', 'a.b'],
    ['appId', 'com.example.app'],
    ['appId', 'com.Example.App2'],
    ['appId', APP_ID_AT_LIMIT],
    ['scheme', 'a'],
    ['scheme', 'myapp'],
    ['scheme', 'com.example.my-app2'],
    ['scheme', 'httpx'],
    ['scheme', 'webx'],
    ['scheme', 'administrator'],
    ['scheme', SCHEME_AT_LIMIT],
  ] as const)('accepts %s %j', (field, value) => {
    expect(checkMobileField(field, value)).toBeUndefined();
  });

  it('counts the limits it was written against', () => {
    expect([THIRTY.length, APP_ID_AT_LIMIT.length, SCHEME_AT_LIMIT.length]).toEqual([30, 155, 128]);
  });

  it.each([
    ['name', ''],
    ['name', '   '],
    ['name', ' Notes'],
    ['name', 'Notes '],
    ['name', 'No\ntes'],
    ['name', 'No\ttes'],
    ['name', `No${String.fromCharCode(0x2028)}tes`],
    ['name', `${THIRTY}x`],
    ['slug', ''],
    ['slug', 'My-App'],
    ['slug', '-app'],
    ['slug', 'my app'],
    ['slug', 'my.app'],
    ['slug', `${SIXTY_FOUR}a`],
    ['appId', ''],
    ['appId', 'app'],
    ['appId', 'com.1app'],
    ['appId', 'com.my-app'],
    ['appId', 'com.my_app'],
    ['appId', 'com..app'],
    ['appId', '.com.app'],
    ['appId', 'com.app.'],
    ['appId', 'com.new.app'],
    ['appId', 'com.example.app;rm'],
    ['appId', `${APP_ID_AT_LIMIT}x`],
    ['scheme', ''],
    ['scheme', 'MyApp'],
    ['scheme', '1app'],
    ['scheme', 'my+app'],
    ['scheme', 'my_app'],
    ['scheme', 'my app'],
    ['scheme', 'myapp://'],
    ['scheme', 'http'],
    ['scheme', 'https'],
    ['scheme', 'file'],
    ['scheme', 'javascript'],
    ['scheme', 'web'],
    ['scheme', 'admin'],
    ['scheme', 'WEB'],
    ['scheme', 'Admin'],
    ['scheme', `${SCHEME_AT_LIMIT}b`],
  ] as const)('refuses %s %j with a reason', (field, value) => {
    const message = checkMobileField(field, value);

    expect(typeof message).toBe('string');
    expect(message).not.toBe('');
  });
});

describe('defaultMobileIdentity', () => {
  it.each([
    [
      'my-app',
      { name: 'My App', slug: 'my-app', appId: 'com.example.myapp', scheme: 'com.example.myapp' },
    ],
    [
      'Shop_API.v2',
      {
        name: 'Shop API V2',
        slug: 'shop-api-v2',
        appId: 'com.example.shopapiv2',
        scheme: 'com.example.shopapiv2',
      },
    ],
    [
      '123go',
      {
        name: '123go',
        slug: '123go',
        appId: 'com.example.app123go',
        scheme: 'com.example.app123go',
      },
    ],
    [
      'new',
      { name: 'New', slug: 'new', appId: 'com.example.newapp', scheme: 'com.example.newapp' },
    ],
    ['---', { name: 'App', slug: 'app', appId: 'com.example.app', scheme: 'com.example.app' }],
  ])('builds every field from the project name %j', (projectName, expected) => {
    expect(defaultMobileIdentity(projectName)).toEqual(expected);
  });

  it.each([
    'my-app',
    '123go',
    'new',
    '---',
    'x'.repeat(214),
    'a-very-long-project-name-that-keeps-going',
  ])('builds values that pass their own checks for %j', (projectName) => {
    const identity = defaultMobileIdentity(projectName);

    expect([
      checkMobileField('name', identity.name),
      checkMobileField('slug', identity.slug),
      checkMobileField('appId', identity.appId),
      checkMobileField('scheme', identity.scheme),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('resolveMobileIdentity', () => {
  it('lays a given field over the defaults and leaves the others', () => {
    expect(resolveMobileIdentity({ scheme: 'notes' }, 'my-app')).toEqual({
      identity: { name: 'My App', slug: 'my-app', appId: 'com.example.myapp', scheme: 'notes' },
      problems: [],
    });
  });

  it('reports each refused field by name and keeps its default', () => {
    const result = resolveMobileIdentity({ appId: 'app', scheme: 'https' }, 'my-app');

    expect(result.identity.appId).toBe('com.example.myapp');
    expect(result.identity.scheme).toBe('com.example.myapp');
    expect(result.problems.map((problem) => problem.field)).toEqual(['appId', 'scheme']);
  });

  it('builds the return address from the scheme', () => {
    expect(callbackAddress('org.sample.notes')).toBe('org.sample.notes://oauth/callback');
  });
});

describe('the mobile identity in a plan', () => {
  it('has none for a project without a mobile app', () => {
    const plan = resolvePlan(TARGETS_MANIFEST, { targets: ['web'] });

    expect('mobile' in plan).toBe(false);
    expect(plan.errors).toEqual([]);
  });

  it('builds it from the project name when a mobile app is chosen', () => {
    const plan = resolvePlan(TARGETS_MANIFEST, {
      targets: ['web', 'native-expo'],
      projectName: 'field-notes',
    });

    expect(plan.mobile).toEqual({
      name: 'Field Notes',
      slug: 'field-notes',
      appId: 'com.example.fieldnotes',
      scheme: 'com.example.fieldnotes',
    });
    expect(plan.errors).toEqual([]);
  });

  it('refuses an identity given for a project without a mobile app', () => {
    const plan = resolvePlan(TARGETS_MANIFEST, { targets: ['web'], mobile: { name: 'Notes' } });

    expect(plan.errors).toEqual([{ id: 'name', reason: 'identity-unused' }]);
    expect(describePlanErrors(TARGETS_MANIFEST, plan.errors)).toEqual([
      '--mobile-name names a mobile app, and no mobile client was chosen. Add native-expo to --targets or leave it out.',
    ]);
  });

  it('turns a refused value into an error that names its flag', () => {
    const plan = resolvePlan(TARGETS_MANIFEST, {
      targets: ['native-expo'],
      mobile: { scheme: 'https' },
    });

    expect(plan.errors.map(({ id, reason }) => ({ id, reason }))).toEqual([
      { id: 'scheme', reason: 'identity' },
    ]);
    expect(describePlanErrors(TARGETS_MANIFEST, plan.errors)[0]).toMatch(/^--mobile-scheme: /);
  });
});
