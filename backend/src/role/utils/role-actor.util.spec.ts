import { HttpException } from '@nestjs/common';
import { CUSTOM_ROLE_LEVEL } from '../../common/utils/role-hierarchy';
import { assertLevelBelowActor } from './role-actor.util';

function answer(level: number, permissions: string[], actorLevel: number) {
  try {
    assertLevelBelowActor(
      { level: actorLevel, isAdmin: false, permissions },
      level,
    );
    return 'allowed';
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : 'not refused';
  }
}

describe('a role level stays below the caller', () => {
  it.each([
    ['the default level for a level-1 caller', CUSTOM_ROLE_LEVEL, [], 1, 403],
    [
      'the default level for a level-1 wildcard',
      CUSTOM_ROLE_LEVEL,
      ['*'],
      1,
      403,
    ],
    ['a level equal to the caller', 3, [], 3, 403],
    ['a level above the caller', 4, ['*'], 3, 403],
    ['a level below the caller', 2, [], 3, 'allowed'],
  ])('answers %s', (_, level, permissions, actorLevel, expected) => {
    expect(answer(level, permissions, actorLevel)).toBe(expected);
  });
});
