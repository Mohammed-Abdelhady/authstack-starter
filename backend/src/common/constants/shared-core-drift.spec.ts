import { HttpException, Logger } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ErrorCode as BackendErrorCode } from '../enums/error-code.enum';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import { ALL_PERMISSIONS as BackendAllPermissions } from './permissions';
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_DESCRIPTION,
  PASSWORD_REQUIREMENTS_MESSAGE,
} from './password';
import { ErrorCode as SharedErrorCode } from '../../../../shared/core/src/error-codes';
import { getStatusErrorCode } from '../../../../shared/core/src/api-error-helpers';
import { ALL_PERMISSIONS as SharedAllPermissions } from '../../../../shared/core/src/permissions';
import {
  MIN_PASSWORD_LENGTH as SharedMinPasswordLength,
  MAX_PASSWORD_BYTES as SharedMaxPasswordBytes,
  PASSWORD_POLICY_DESCRIPTION as SharedPasswordPolicyDescription,
  PASSWORD_REQUIREMENTS_MESSAGE as SharedPasswordRequirementsMessage,
} from '../../../../shared/core/src/password-rules';

// Backend-only error codes the web client maps by status code or a generic message instead.
const BACKEND_ONLY_ERROR_CODES = [
  'ROLE_NOT_FOUND', // role seeding lookup; the web client surfaces generic NOT_FOUND.
];

// Codes a client assigns itself and the server never sends.
const SHARED_ONLY_ERROR_CODES = [
  'UNKNOWN_ERROR', // a response with no code and a status with no mapping.
];

// Every status the exception filter maps for an HttpException that carries no code.
const FILTER_MAPPED_STATUSES = [400, 401, 403, 404, 409, 429];

// What the filter answers for a status it has no row for.
const FILTER_FALLBACK_CODE = 'INTERNAL_ERROR';

const ERROR_STATUSES = Array.from({ length: 200 }, (_, index) => 400 + index);

function sortedStrings(values: readonly unknown[]): string[] {
  return [...new Set(values.map(String))].sort();
}

interface FilterReply {
  status?: number;
  body?: { error: { code: string } };
}

/** The code the real filter writes for an exception that has only a status. */
function filterCodeFor(status: number): string | undefined {
  const reply: FilterReply = {};
  const response = {
    status(code: number) {
      reply.status = code;
      return response;
    },
    json(body: FilterReply['body']) {
      reply.body = body;
      return response;
    },
  };

  new GlobalExceptionFilter().catch(
    new HttpException('no code', status),
    new ExecutionContextHost([{}, response]),
  );

  return reply.status === status ? reply.body?.error.code : undefined;
}

describe('shared core drift', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the same permission strings on both sides', () => {
    const backend = sortedStrings(BackendAllPermissions);
    const shared = sortedStrings(SharedAllPermissions);

    expect(shared).toEqual(backend);
  });

  it('keeps the same error-code values except the named one-sided ones', () => {
    const backend = sortedStrings(Object.values(BackendErrorCode));
    const shared = sortedStrings(Object.values(SharedErrorCode));

    const backendOnly = backend.filter((code) => !shared.includes(code));
    const sharedOnly = shared.filter((code) => !backend.includes(code));

    expect(backendOnly).toEqual([...BACKEND_ONLY_ERROR_CODES].sort());
    expect(sharedOnly).toEqual([...SHARED_ONLY_ERROR_CODES].sort());
  });

  it.each(FILTER_MAPPED_STATUSES)(
    'maps a bare %i to the same code as the exception filter',
    (status) => {
      const server = filterCodeFor(status);

      expect(server).toEqual(expect.any(String));
      expect(getStatusErrorCode(status)).toBe(server);
    },
  );

  it('lists every status the exception filter maps', () => {
    const mapped = ERROR_STATUSES.filter(
      (status) => filterCodeFor(status) !== FILTER_FALLBACK_CODE,
    );

    expect(mapped).toEqual(FILTER_MAPPED_STATUSES);
  });

  it('maps a bare 500 to the same code as the exception filter', () => {
    expect(filterCodeFor(500)).toBe('INTERNAL_ERROR');
    expect(getStatusErrorCode(500)).toBe('INTERNAL_ERROR');
  });

  it('keeps the same minimum password length on both sides', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(SharedMinPasswordLength);
  });

  it('keeps the same maximum password bytes on both sides', () => {
    expect(PASSWORD_MAX_BYTES).toBe(SharedMaxPasswordBytes);
  });

  it('keeps the same password requirements message on both sides', () => {
    expect(PASSWORD_REQUIREMENTS_MESSAGE).toBe(
      SharedPasswordRequirementsMessage,
    );
  });

  it('keeps the same password policy description on both sides', () => {
    expect(PASSWORD_POLICY_DESCRIPTION).toBe(SharedPasswordPolicyDescription);
  });
});
