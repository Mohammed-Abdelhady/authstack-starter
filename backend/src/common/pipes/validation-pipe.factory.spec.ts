import { ValidationError } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AppException } from '../exceptions/app.exception';
import {
  collectValidationFields,
  createValidationPipe,
  summarizeValidationFields,
} from './validation-pipe.factory';

class AddressDto {
  @IsNotEmpty()
  city!: string;
}

class ItemDto {
  @MinLength(2)
  name!: string;
}

class OrderDto {
  @MinLength(2, { message: 'Name must be at least 2 characters' })
  name!: string;

  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;

  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items!: ItemDto[];

  @Matches(/^[a-z]+$/, {
    each: true,
    message: 'Each tag must be lowercase letters',
  })
  tags!: string[];
}

const VALID_ORDER = {
  name: 'Layla',
  email: 'layla@example.com',
  address: { city: 'Amman' },
  items: [{ name: 'Tea' }],
  tags: ['tea'],
};

async function rejectionOf(body: unknown): Promise<AppException> {
  try {
    await createValidationPipe().transform(body, {
      type: 'body',
      metatype: OrderDto,
    });
  } catch (error) {
    if (error instanceof AppException) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected the pipe to reject the body');
}

describe('collectValidationFields', () => {
  it('keeps a property named __proto__ as an ordinary key', () => {
    const fields = collectValidationFields([
      {
        property: '__proto__',
        constraints: { whitelistValidation: 'not allowed' },
      },
    ]);

    expect(Object.keys(fields)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(fields, '__proto__')?.value).toEqual(
      ['not allowed'],
    );
  });
});

describe('summarizeValidationFields', () => {
  it('counts a property the DTO does not declare instead of naming it', () => {
    const errors: ValidationError[] = [
      { property: 'name', constraints: { minLength: 'Name is too short' } },
      {
        property: 'hunter2',
        constraints: {
          whitelistValidation: 'property hunter2 should not exist',
        },
      },
    ];

    expect(summarizeValidationFields(errors)).toEqual({
      fieldNames: ['name'],
      omittedCount: 1,
    });
  });

  it('counts a name that could break a log line instead of naming it', () => {
    const errors: ValidationError[] = [
      {
        property: 'labels',
        children: [
          {
            property: 'x\n[Nest] forged line',
            constraints: { isString: 'must be a string' },
          },
        ],
      },
    ];

    expect(summarizeValidationFields(errors)).toEqual({
      fieldNames: [],
      omittedCount: 1,
    });
  });

  it('names at most twenty fields and counts the rest', () => {
    const errors: ValidationError[] = Array.from(
      { length: 23 },
      (_unused, index) => ({
        property: `field${index}`,
        constraints: { isString: 'must be a string' },
      }),
    );

    const summary = summarizeValidationFields(errors);

    expect(summary.fieldNames).toHaveLength(20);
    expect(summary.fieldNames[0]).toBe('field0');
    expect(summary.fieldNames[19]).toBe('field19');
    expect(summary.omittedCount).toBe(3);
  });
});

describe('createValidationPipe', () => {
  it('keys a property the DTO does not have by that property', async () => {
    const exception = await rejectionOf({ ...VALID_ORDER, isAdmin: true });

    expect(exception.getDetails()).toEqual({
      fields: { isAdmin: ['property isAdmin should not exist'] },
    });
  });
});
