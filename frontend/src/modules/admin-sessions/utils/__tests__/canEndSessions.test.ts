import { describe, expect, it } from 'vitest';
import type { RoleAudience } from '@app/core';
import { canEndSessions } from '../canEndSessions';

const CASES: {
  name: string;
  permissions: string[];
  targetClass: RoleAudience | undefined;
  expected: boolean;
}[] = [
  {
    name: 'refuses staff without the staff delete scope',
    permissions: ['sessions:delete:all'],
    targetClass: 'staff',
    expected: false,
  },
  {
    name: 'allows staff with both delete scopes',
    permissions: ['sessions:delete:all', 'sessions:delete:staff'],
    targetClass: 'staff',
    expected: true,
  },
  {
    name: 'allows customers with the all delete scope',
    permissions: ['sessions:delete:all'],
    targetClass: 'customer',
    expected: true,
  },
  {
    name: 'refuses staff without the all delete scope',
    permissions: ['sessions:delete:staff'],
    targetClass: 'staff',
    expected: false,
  },
  {
    name: 'refuses customers without the all delete scope',
    permissions: [],
    targetClass: 'customer',
    expected: false,
  },
  {
    name: 'refuses an unknown target class before the list is available',
    permissions: ['*'],
    targetClass: undefined,
    expected: false,
  },
  {
    name: 'allows wildcard holders to end staff sessions',
    permissions: ['*'],
    targetClass: 'staff',
    expected: true,
  },
];

describe('staff session end authority', () => {
  it.each(CASES)('$name', ({ permissions, targetClass, expected }) => {
    expect(canEndSessions(permissions, targetClass)).toBe(expected);
  });
});
