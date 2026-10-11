import type { Response } from 'supertest';
import { AppException } from '../../src/common/exceptions/app.exception';
import { RouteIdPipe } from '../../src/common/pipes/route-id.pipe';

/** Everything a client can tell apart in a refusal. */
export interface RefusalAnswer {
  status: number;
  success: unknown;
  code: unknown;
  message: unknown;
  bodyKeys: string[];
  errorKeys: string[];
}

interface RefusalBody {
  success?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export function refusalAnswer(response: Response): RefusalAnswer {
  const body = response.body as RefusalBody;
  return {
    status: response.status,
    success: body.success,
    code: body.error?.code,
    message: body.error?.message,
    bodyKeys: Object.keys(body).sort(),
    errorKeys: Object.keys(body.error ?? {}).sort(),
  };
}

/** A refusal in the envelope every error leaves in. */
export function refusal(
  status: number,
  code: string,
  message: string,
  errorKeys: string[] = ['code', 'message'],
): RefusalAnswer {
  return {
    status,
    success: false,
    code,
    message,
    bodyKeys: ['error', 'requestId', 'success'],
    errorKeys,
  };
}

/** What a route answered for an id no database could have issued. */
export const MALFORMED_ID_ANSWER = refusal(
  400,
  'INVALID_INPUT',
  'Invalid identifier format',
);

/**
 * The ids of one database: the form it issues, one that names nothing, and
 * the ones it refuses.
 */
interface RouteIds {
  form: RegExp;
  absent: string;
  malformed: ReadonlyArray<readonly [string, string]>;
}

// feature:mongodb:start
const MONGODB_IDS: RouteIds = {
  form: /^[0-9a-f]{24}$/,
  absent: '507f1f77bcf86cd799439011',
  malformed: [
    ['a word', 'not-an-id'],
    ['one character short', '507f1f77bcf86cd79943901'],
    ['one character long', '507f1f77bcf86cd7994390111'],
    ['the right length with a letter past f', '507f1f77bcf86cd79943901z'],
    ["the other database's id", '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f'],
    ['a query operator', '%7B%22%24ne%22%3Anull%7D'],
    ['three hundred characters', 'a'.repeat(300)],
  ],
};
// feature:mongodb:end

// feature:postgres:start
const POSTGRES_IDS: RouteIds = {
  form: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  absent: '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f',
  malformed: [
    ['a word', 'not-an-id'],
    ['one character short', '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5'],
    ['one character long', '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5f1'],
    [
      'the right length with a letter past f',
      '018f4d2e-7b1a-7c3d-9e2f-0a1b2c3d4e5z',
    ],
    ["the other database's id", '507f1f77bcf86cd799439011'],
    ['a query operator', '%7B%22%24ne%22%3Anull%7D'],
    ['three hundred characters', 'a'.repeat(300)],
  ],
};
// feature:postgres:end

function routeIds(): RouteIds {
  // feature:postgres:start
  if (process.env.DATABASE_TYPE === 'postgres') return POSTGRES_IDS;
  // feature:postgres:end
  return MONGODB_IDS;
}

/** What an id issued by the database this run is on looks like. */
export const ISSUED_ID_FORM = routeIds().form;

/** Well-formed on the database this run is on, and naming nothing. */
export const ABSENT_ID = routeIds().absent;

/** Path segments as they are sent, each malformed on this run's database. */
export const MALFORMED_IDS: ReadonlyArray<readonly [string, string]> =
  routeIds().malformed;

/** How a route's id check refuses, as a service-level case sees it. */
export const ROUTE_ID_REFUSAL = { code: 'INVALID_INPUT', status: 400 };

/** The id a route's check let through, or the code and status it refused with. */
export function routeIdAnswer(pipe: RouteIdPipe, id: string): unknown {
  try {
    return pipe.transform(id);
  } catch (error) {
    if (!(error instanceof AppException)) throw error;
    return { code: error.getCode(), status: error.getStatus() };
  }
}
