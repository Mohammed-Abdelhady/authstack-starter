import { Logger, Type } from '@nestjs/common';
import { createValidationPipe } from '../../common/pipes/validation-pipe.factory';
import { CreateRoleDto } from './create-role.dto';
import { UpdateRoleDto } from './update-role.dto';

const VALID_ROLE = { name: 'Content Editor', permissions: ['posts:read:all'] };

/** What the application's own pipe makes of a request body, or the error it throws. */
async function bodyLevel(
  metatype: Type<CreateRoleDto | UpdateRoleDto>,
  body: Record<string, unknown>,
): Promise<{ level: unknown } | { refused: string }> {
  try {
    const dto: unknown = await createValidationPipe().transform(body, {
      type: 'body',
      metatype,
    });
    return { level: Reflect.get(Object(dto), 'level') };
  } catch (error) {
    return { refused: error instanceof Error ? error.name : 'not an error' };
  }
}

describe.each([
  ['CreateRoleDto', CreateRoleDto, VALID_ROLE],
  ['UpdateRoleDto', UpdateRoleDto, {}],
] as const)('the level on %s', (_, metatype, base) => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('may be left out', async () => {
    expect(await bodyLevel(metatype, { ...base })).toEqual({
      level: undefined,
    });
  });

  it.each([1, 3])('accepts the integer %p', async (level) => {
    expect(await bodyLevel(metatype, { ...base, level })).toEqual({ level });
  });

  it.each([0, -1, 1.5, 'two', null])('refuses %p', async (level) => {
    expect(await bodyLevel(metatype, { ...base, level })).toEqual({
      refused: 'ValidationFailedException',
    });
  });
});
