import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { createValidationPipe } from '../pipes/validation-pipe.factory';
import { UpdateProfileDto } from '../../user/dto/update-profile.dto';
import { CreateUserDto } from '../../admin/dto/create-user.dto';
import { UpdateUserDto } from '../../admin/dto/update-user.dto';
import { ActivateDto } from '../../auth/dto/activate.dto';
import {
  NAME_LENGTH_MESSAGE,
  NAME_MESSAGE,
  NAME_NO_LETTER_MESSAGE,
  NAME_REQUIRED_MESSAGE,
} from '../constants/name';
import { zodName } from '../../../../shared/core/src/validations/string/identity';

const CASES: Array<{
  name: unknown;
  expected: 'accept' | 'reject';
  why: string;
  message: 'length' | 'characters' | 'letters' | 'required';
  stored?: string;
}> = [
  { name: '', expected: 'reject', why: 'empty', message: 'required' },
  { name: '   ', expected: 'reject', why: 'spaces only', message: 'required' },
  { name: 'A', expected: 'reject', why: 'one character', message: 'length' },
  { name: 'Bo', expected: 'accept', why: 'minimum length', message: 'length' },
  {
    name: 'a'.repeat(100),
    expected: 'accept',
    why: 'maximum length',
    message: 'length',
  },
  {
    name: 'a'.repeat(101),
    expected: 'reject',
    why: 'maximum plus one',
    message: 'length',
  },
  {
    name: 'a'.repeat(81),
    expected: 'accept',
    why: 'length the old server cap refused',
    message: 'length',
  },
  {
    name: '\u0623\u062d\u0645\u062f',
    expected: 'accept',
    why: 'letters outside A-Z',
    message: 'characters',
  },
  {
    name: '\u0645\u064f\u062d\u064e\u0645\u0651\u064e\u062f',
    expected: 'accept',
    why: 'letters with combining marks',
    message: 'characters',
  },
  {
    name: '\u5c71\u7530\u592a\u90ce',
    expected: 'accept',
    why: 'CJK letters',
    message: 'characters',
  },
  {
    name: '\u{1F600}\u{1F600}',
    expected: 'reject',
    why: 'emoji',
    message: 'characters',
  },
  { name: '<b>', expected: 'reject', why: 'HTML', message: 'characters' },
  {
    name: 'user@example.com',
    expected: 'reject',
    why: 'an address typed as a name',
    message: 'characters',
  },
  {
    name: 'john_doe',
    expected: 'reject',
    why: 'underscore',
    message: 'characters',
  },
  {
    name: 'Layla\tHaddad',
    expected: 'reject',
    why: 'tab',
    message: 'characters',
  },
  {
    name: 'Bob\nAdmin',
    expected: 'reject',
    why: 'line feed',
    message: 'characters',
  },
  {
    name: 'Bob\r\nBcc',
    expected: 'reject',
    why: 'carriage return and line feed',
    message: 'characters',
  },
  {
    name: 'Bob\u2028Lee',
    expected: 'reject',
    why: 'line separator',
    message: 'characters',
  },
  {
    name: 'Bo\ufeffb',
    expected: 'reject',
    why: 'zero width no-break space',
    message: 'characters',
  },
  {
    name: 'Bo\u000b\u000cb',
    expected: 'reject',
    why: 'vertical tab and form feed',
    message: 'characters',
  },
  {
    name: `a${'\u0301'.repeat(99)}`,
    expected: 'accept',
    why: 'one letter with 99 combining marks',
    message: 'characters',
  },
  {
    name: '\u0301\u0301',
    expected: 'reject',
    why: 'only combining marks, no letter',
    message: 'letters',
  },
  {
    name: "'-.",
    expected: 'reject',
    why: 'only punctuation, no letter',
    message: 'letters',
  },
  {
    name: '12',
    expected: 'reject',
    why: 'only digits, no letter',
    message: 'letters',
  },
  {
    name: '\u{20000}',
    expected: 'reject',
    why: 'one astral code point, below the minimum',
    message: 'length',
  },
  {
    name: '\u{20000}'.repeat(51),
    expected: 'accept',
    why: '51 astral code points, code-point length not UTF-16',
    message: 'length',
  },
  {
    name: '  John Doe  ',
    expected: 'accept',
    why: 'padded, stored trimmed',
    message: 'characters',
    stored: 'John Doe',
  },
  {
    name: 'Jos\u00e9',
    expected: 'accept',
    why: 'precomposed accent, stored NFC',
    message: 'characters',
    stored: 'Jos\u00e9',
  },
  {
    name: 'Jose\u0301',
    expected: 'accept',
    why: 'decomposed accent, stored NFC like the precomposed one',
    message: 'characters',
    stored: 'Jos\u00e9',
  },
  {
    name: '\u1100\u1161',
    expected: 'reject',
    why: 'hangul jamo pair, NFC composes it to one code point',
    message: 'length',
  },
  {
    name: '\u0958',
    expected: 'accept',
    why: 'one NFC-expanding letter, two code points after normalisation',
    message: 'length',
  },
  {
    name: '\u0958'.repeat(51),
    expected: 'reject',
    why: 'NFC-expanding letters, 102 code points after normalisation',
    message: 'length',
  },
  {
    name: '\u0958'.repeat(100),
    expected: 'reject',
    why: 'NFC-expanding letters, 200 code points after normalisation',
    message: 'length',
  },
  {
    name: `e\u0301`.repeat(51),
    expected: 'accept',
    why: '51 pairs that NFC composes to 51 code points',
    message: 'length',
    stored: '\u00e9'.repeat(51),
  },
  {
    name: `a${'\u0301'.repeat(100)}`,
    expected: 'accept',
    why: 'the first mark composes to á, then 99 marks: 100 code points',
    message: 'length',
  },
];

const pipe: ValidationPipe = createValidationPipe();

/** Any DTO class the pipe builds from a body, whatever its fields' types. */
type BodyDto = new () => object;

/** The UpdateProfileDto instance the real pipe produces for a body. */
async function serverRow(
  name: unknown,
  metatype: BodyDto = UpdateProfileDto,
  body: Record<string, string> = {},
): Promise<{
  accepted: boolean;
  stored?: unknown;
  fields?: string[];
  status?: number;
}> {
  try {
    const instance = await pipe.transform(
      { ...body, name },
      { metatype, type: 'body' },
    );
    const stored = (instance as { name?: unknown }).name;
    return { accepted: true, stored };
  } catch (error) {
    const details =
      error instanceof AppException ? error.getDetails() : undefined;
    const fields = details as { fields?: Record<string, string[]> } | undefined;
    return {
      accepted: false,
      fields: fields?.fields?.name,
      status: error instanceof AppException ? error.getStatus() : undefined,
    };
  }
}

function sharedRow(name: unknown): { accepted: boolean; stored?: string } {
  const schema = zodName({
    required: true,
    min: 2,
    max: 100,
    messages: {
      required: 'required',
      min: 'min',
      max: 'max',
      pattern: 'pattern',
    },
  });
  const result = schema.safeParse(name);
  return result.success
    ? { accepted: true, stored: result.data }
    : { accepted: false };
}

/** The signup column is asserted beside the real form schema in the frontend activation tests. */

describe('the name rule the server and the shared rule agree on', () => {
  it.each(CASES)('$why', async ({ name, expected, message, stored }) => {
    const [server, shared] = await Promise.all([
      serverRow(name),
      Promise.resolve(sharedRow(name)),
    ]);

    const want = expected === 'accept';
    expect(server.accepted).toBe(want);
    expect(shared.accepted).toBe(want);

    if (stored !== undefined) {
      expect(server.stored).toBe(stored);
      expect(shared.stored).toBe(stored);
    }
    if (!want) {
      expect(server.fields?.[0]).toBe(
        message === 'required'
          ? NAME_REQUIRED_MESSAGE
          : message === 'length'
            ? NAME_LENGTH_MESSAGE
            : message === 'letters'
              ? NAME_NO_LETTER_MESSAGE
              : NAME_MESSAGE,
      );
    }
  });

  it.each<{ metatype: BodyDto; body: Record<string, string> }>([
    { metatype: UpdateProfileDto, body: {} },
    { metatype: UpdateUserDto, body: {} },
    {
      metatype: CreateUserDto,
      body: {
        email: 'user@example.com',
        password: 'Password123',
        role: 'user',
      },
    },
    {
      metatype: ActivateDto,
      body: {
        email: 'user@example.com',
        password: 'Password123',
        code: '000000',
      },
    },
  ])(
    'sends a string-type field error on $metatype.name',
    async ({ metatype, body }) => {
      for (const name of [12, ['ab'], { a: 1 }, true, false]) {
        const row = await serverRow(name, metatype, body);
        expect(row.accepted).toBe(false);
        expect(row.status).toBe(400);
        expect(row.fields).toEqual(
          expect.arrayContaining([expect.stringMatching(/must be a string$/)]),
        );
      }
    },
  );

  it('keeps an absent name absent on the optional profile field', async () => {
    const row = await serverRow(undefined);
    expect(row.accepted).toBe(true);
    expect(row.stored).toBeUndefined();
  });

  it('accepts the shared schema output through the real server pipe', async () => {
    const shared = sharedRow('  Jose\u0301  ');
    expect(shared.stored).toBe('Jos\u00e9');
    const server = await serverRow(shared.stored);
    expect(server.accepted).toBe(true);
    expect(server.stored).toBe('Jos\u00e9');
  });
});
