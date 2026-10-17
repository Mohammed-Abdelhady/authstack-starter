import { describe, expect, it } from 'vitest';
import { levelOfRole, roleRefusal } from '../roleAssignment';

const ROLES = [
  { slug: 'user', level: 1 },
  { slug: 'support', level: 2 },
  { slug: 'manager', level: 3 },
  { slug: 'admin', level: 4 },
  { slug: 'night-shift', level: 1 },
];

describe('the level of the role a person holds', () => {
  it.each([
    ['a slug the list does not hold', ROLES, 'deleted-role'],
    ['an empty slug', ROLES, ''],
    ['an empty list', [], 'admin'],
  ])('is 0, as on the server, for %s', (_name, roles, slug) => {
    expect(levelOfRole(roles, slug)).toBe(0);
  });
});

describe('whether the server would let a person hand a role out', () => {
  it.each([
    // actor level, role slug, role level, refusal
    [4, 'manager', 3, null],
    [4, 'support', 2, null],
    [4, 'user', 1, null],
    [4, 'night-shift', 1, null],
    [3, 'support', 2, null],
    [3, 'user', 1, null],
    [2, 'user', 1, null],
    [3, 'manager', 3, 'level'],
    [2, 'manager', 3, 'level'],
    [2, 'support', 2, 'level'],
    [1, 'user', 1, 'level'],
    [1, 'night-shift', 1, 'level'],
    [0, 'user', 1, 'level'],
    [4, 'custom-at-the-top', 4, 'level'],
    [4, 'admin', 4, 'admin'],
    [3, 'admin', 4, 'admin'],
    [5, 'admin', 4, 'admin'],
  ] as const)(
    'a person at level %i and the role %s at level %i: %s',
    (actorLevel, slug, level, refusal) => {
      expect(roleRefusal(actorLevel, { slug, level })).toBe(refusal);
    },
  );

  it('takes no account of a role being protected or a system role', () => {
    const role = { slug: 'manager', level: 3, isProtected: true, isSystemRole: true };

    expect(roleRefusal(4, role)).toBeNull();
  });
});
