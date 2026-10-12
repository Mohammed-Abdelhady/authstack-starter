import { ErrorCode } from '../enums/error-code.enum';
import { AppException } from '../exceptions/app.exception';
import { IdFormat } from '../persistence/id-format';
import { MongoIdFormat } from '../persistence/mongo/mongo-id-format';
import { couldBeRouteId, RouteIdPipe } from './route-id.pipe';

/** A database that would take any text, so only the route's own rule refuses. */
class AnyTextFormat extends IdFormat {
  isId(): boolean {
    return true;
  }
}

const OBJECT_ID = '507f1f77bcf86cd799439011';
const UUID = '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f';

function answerOf(pipe: RouteIdPipe, value: unknown): unknown {
  try {
    return pipe.transform(value);
  } catch (error) {
    if (!(error instanceof AppException)) throw error;
    return {
      code: error.getCode(),
      status: error.getStatus(),
      message: error.message,
    };
  }
}

const REFUSED = {
  code: ErrorCode.INVALID_INPUT,
  status: 400,
  message: 'Invalid identifier format',
};

describe('couldBeRouteId', () => {
  it.each([
    ['a MongoDB id', OBJECT_ID],
    ['a UUID', UUID],
    ['one character', 'a'],
    ['letters, digits, a hyphen and an underscore', 'Ab9-_'],
    ['the longest id', 'a'.repeat(128)],
  ])('takes %s', (_, value) => {
    expect(couldBeRouteId(value)).toBe(true);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a number', 12345],
    ['an object', { $ne: null }],
    ['an array', [OBJECT_ID]],
    ['one character past the longest id', 'a'.repeat(129)],
    ['a query operator', '{"$ne":null}'],
    ['a dollar sign', '$where'],
    ['a dot', 'a.b'],
    ['a slash', 'a/b'],
    ['a space', 'a b'],
    ['a line break after an id', `${OBJECT_ID}\n`],
    ['a percent sign', '%24ne'],
    ['a letter outside ASCII', 'idé'],
  ])('refuses %s', (_, value) => {
    expect(couldBeRouteId(value)).toBe(false);
  });
});

describe('RouteIdPipe', () => {
  it('hands back unchanged an id the database could have issued', () => {
    const pipe = new RouteIdPipe(new MongoIdFormat());

    expect([
      answerOf(pipe, OBJECT_ID),
      answerOf(pipe, '507F1F77BCF86CD799439011'),
    ]).toEqual([OBJECT_ID, '507F1F77BCF86CD799439011']);
  });

  it.each([
    ['a short string', '123'],
    ['24 characters with a letter past f', '507f1f77bcf86cd79943901z'],
    ['23 characters', '507f1f77bcf86cd79943901'],
    ['25 characters', '507f1f77bcf86cd7994390111'],
    ['12 characters', '123456789012'],
    ["another database's id", UUID],
    ['a number', 12345],
    ['an empty string', ''],
  ])('refuses %s on MongoDB as the routes always have', (_, value) => {
    expect(answerOf(new RouteIdPipe(new MongoIdFormat()), value)).toEqual(
      REFUSED,
    );
  });

  it('refuses what no database could use even when the database would take it', () => {
    const pipe = new RouteIdPipe(new AnyTextFormat());

    expect([
      answerOf(pipe, UUID),
      answerOf(pipe, '{"$ne":null}'),
      answerOf(pipe, { $ne: null }),
      answerOf(pipe, 'a'.repeat(129)),
      answerOf(pipe, ''),
    ]).toEqual([UUID, REFUSED, REFUSED, REFUSED, REFUSED]);
  });
});
