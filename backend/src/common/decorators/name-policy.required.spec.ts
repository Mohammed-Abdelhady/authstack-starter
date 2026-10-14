import 'reflect-metadata';
import { AppException } from '../exceptions/app.exception';
import { createValidationPipe } from '../pipes/validation-pipe.factory';
import { NAME_REQUIRED_MESSAGE } from '../constants/name';
import { UpdateProfileDto } from '../../user/dto/update-profile.dto';
import { UpdateUserDto } from '../../admin/dto/update-user.dto';
import { CreateUserDto } from '../../admin/dto/create-user.dto';
import { ActivateDto } from '../../auth/dto/activate.dto';

/** Any DTO class the pipe builds from a body, whatever its fields' types. */
type BodyDto = new () => object;

const DTOS: { metatype: BodyDto; body: object; required: boolean }[] = [
  { metatype: UpdateProfileDto, body: {}, required: false },
  { metatype: UpdateUserDto, body: {}, required: false },
  {
    metatype: CreateUserDto,
    body: {
      email: 'user@example.com',
      password: 'Password123',
      role: 'user',
    },
    required: true,
  },
  {
    metatype: ActivateDto,
    body: {
      email: 'user@example.com',
      password: 'Password123',
      code: '000000',
    },
    required: true,
  },
];

const pipe = createValidationPipe();

async function requireNameError(
  body: object,
  metatype: BodyDto,
): Promise<void> {
  try {
    await pipe.transform(body, { metatype, type: 'body' });
    throw new Error('Expected name validation to reject the body');
  } catch (error) {
    if (!(error instanceof AppException)) {
      throw error;
    }
    expect(error.getStatus()).toBe(400);
    expect(error.getDetails()).toEqual({
      fields: { name: [NAME_REQUIRED_MESSAGE] },
    });
  }
}

describe('required name validation through the server pipe', () => {
  it.each(DTOS)(
    'returns one required error for empty or null on $metatype.name',
    async ({ metatype, body }) => {
      for (const name of ['', '   ', null]) {
        await requireNameError({ ...body, name }, metatype);
      }
    },
  );

  it.each(DTOS)(
    'preserves name optionality on $metatype.name',
    async ({ metatype, body, required }) => {
      if (required) {
        await requireNameError(body, metatype);
        await requireNameError({ ...body, name: undefined }, metatype);
        return;
      }
      await expect(
        pipe.transform(body, { metatype, type: 'body' }),
      ).resolves.toEqual({});
      await expect(
        pipe.transform(
          { ...body, name: undefined },
          { metatype, type: 'body' },
        ),
      ).resolves.toEqual({ name: undefined });
    },
  );
});
