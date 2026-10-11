import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { AppException } from '../exceptions/app.exception';
import { isUnknownTransactionOutcome } from '../exceptions/unknown-transaction-outcome.error';
import { ValidationFailedException } from '../exceptions/validation-failed.exception';
import { ErrorCode } from '../enums/error-code.enum';
import { ErrorResponse } from '../dto/api-response.dto';
import { RequestWithId } from '../interfaces/request-with-id.interface';
import {
  MalformedIdError,
  UniqueConflictError,
} from '../persistence/persistence-errors';
import { sharedErrorOfSqlFailure } from '../persistence/sql-failure'; // feature:postgres
import { describeDriverError, errorToken } from '../utils/describe-error.util';
import {
  isCastError,
  isDuplicateKeyError,
  isDuplicateEmailError,
} from '../utils/driver-error-shape.util';

/** What a driver CastError may carry: the field, never the offending value. */
interface CastErrorFacts {
  path?: unknown;
  value?: unknown;
}

/**
 * A loggable line for a driver CastError: the field path and the value's
 * runtime type, because the message embeds the value itself.
 */
function describeCastError(error: CastErrorFacts): string {
  const valueKind = error.value === null ? 'null' : typeof error.value;
  const pathName = errorToken(error.path);
  return `path=${pathName} value=${valueKind}`;
}

/** The colliding key names of a duplicate-key error, never their values. */
function describeDuplicateKeys(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }
  const facts = error as {
    keyPattern?: Record<string, unknown>;
    keyValue?: Record<string, unknown>;
  };
  if (facts.keyPattern) {
    return JSON.stringify(
      Object.keys(facts.keyPattern).map((key) => errorToken(key)),
    );
  }
  if (facts.keyValue) {
    return JSON.stringify(
      Object.keys(facts.keyValue).map((key) => errorToken(key)),
    );
  }
  return 'unknown';
}

const EMAIL_RULE = /email/i;

/**
 * Whether a refused unique rule is the one on an account's address. The driver
 * error under it decides, as it does when it arrives bare, and the rule's
 * shared name decides for an adapter whose driver error says nothing.
 */
function isAddressConflict(conflict: UniqueConflictError): boolean {
  return (
    isDuplicateEmailError(conflict.cause) ||
    EMAIL_RULE.test(conflict.constraint)
  );
}

/** Facts an unknown exception may share in its log line without its text. */
interface UnknownExceptionFacts {
  errors?: Record<string, { path?: unknown }>;
}

/**
 * The loggable facts about an unknown failure: its name, its driver code
 * when present, and which fields a Mongoose ValidationError blames. The
 * message itself is left out, since driver messages carry raw values.
 */
function describeUnknownException(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return `non-object ${typeof error}`;
  }
  const parts = [describeDriverError(error)];
  const validationErrors = (error as UnknownExceptionFacts).errors;
  if (
    validationErrors &&
    typeof validationErrors === 'object' &&
    Object.keys(validationErrors).length > 0
  ) {
    parts.push(
      `paths=${Object.keys(validationErrors)
        .map((key) => errorToken(key))
        .join(',')}`,
    );
  }
  return parts.join(' ');
}

/** Strip the complete message before selecting stack frames. */
function stackFrames(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }
  const head = error.message ? `${error.name}: ${error.message}` : error.name;
  if (!error.stack.startsWith(head)) return undefined;
  const frames = error.stack
    .slice(head.length)
    .split('\n')
    .filter((line) => /^\s+at /.test(line));
  return frames.length > 0 ? frames.join('\n') : undefined;
}

/**
 * Global exception filter that transforms exceptions into standardized error responses.
 * Handles AppException, ThrottlerException, HttpException, CastError, MongoServerError 11000, the shared persistence errors, and unknown errors.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(raised: unknown, host: ArgumentsHost): void {
    const exception =
      // feature:postgres:start
      // A SQL failure left as raised is answered as the shared error it is.
      sharedErrorOfSqlFailure(raised) ??
      // feature:postgres:end
      raised;
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = ctx.getRequest<RequestWithId>().requestId;

    const tag = requestId ? ` [${requestId}]` : '';

    let errorResponse: ErrorResponse;
    let statusCode: number;

    if (exception instanceof AppException) {
      statusCode = exception.getStatus();
      errorResponse = ErrorResponse.error(
        exception.getCode(),
        exception.message,
        exception.getDetails(),
      );
      this.logger.warn(
        `AppException (${statusCode}): ${exception.getCode()}${this.describeFailedFields(exception)}${tag}`,
      );
    } else if (isUnknownTransactionOutcome(exception)) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      errorResponse = ErrorResponse.error(
        ErrorCode.TRANSACTION_OUTCOME_UNKNOWN,
        'The transaction outcome is unknown',
      );
      this.logger.error(
        `Unknown transaction outcome: ${describeDriverError(exception)}${tag}`,
        stackFrames(exception),
      );
    } else if (exception instanceof ThrottlerException) {
      statusCode = HttpStatus.TOO_MANY_REQUESTS;
      const res = exception.getResponse();
      const retryAfter =
        typeof res === 'object' && res !== null && 'retryAfter' in res
          ? (res as { retryAfter: number }).retryAfter
          : 60;
      errorResponse = ErrorResponse.error(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Too many requests',
        { retryAfter },
      );
      this.logger.warn(
        `ThrottlerException (${statusCode}): ${ErrorCode.RATE_LIMIT_EXCEEDED}${tag}`,
      );
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const code = this.mapHttpStatusToErrorCode(statusCode);
      errorResponse = ErrorResponse.error(code, exception.message);
      // Framework messages quote the raw request body, so the line names
      // the status and the mapped code and nothing of the payload.
      this.logger.warn(`HttpException (${statusCode}): ${code}${tag}`);
    } else if (exception instanceof MalformedIdError) {
      // The other shared errors answer as the driver errors under them do
      // today, through the last branch.
      statusCode = HttpStatus.BAD_REQUEST;
      const cast = exception.cause;
      errorResponse = ErrorResponse.error(
        ErrorCode.INVALID_INPUT,
        (isCastError(cast) && cast.message) || 'Invalid input',
      );
      this.logger.warn(
        `MalformedIdError: ${isCastError(cast) ? describeCastError(cast) : describeDriverError(exception)}${tag}`,
      );
    } else if (exception instanceof UniqueConflictError) {
      statusCode = HttpStatus.CONFLICT;
      const isEmail = isAddressConflict(exception);
      errorResponse = ErrorResponse.error(
        isEmail ? ErrorCode.EMAIL_ALREADY_EXISTS : ErrorCode.CONFLICT,
        isEmail ? 'Email already registered' : 'Resource conflict occurred',
      );
      this.logger.warn(
        `UniqueConflictError: constraint=${errorToken(exception.constraint)} keys=${describeDuplicateKeys(exception.cause)}${tag}`,
      );
    } else if (isCastError(exception)) {
      statusCode = HttpStatus.BAD_REQUEST;
      errorResponse = ErrorResponse.error(
        ErrorCode.INVALID_INPUT,
        exception.message || 'Invalid input',
      );
      this.logger.warn(`CastError: ${describeCastError(exception)}${tag}`);
    } else if (isDuplicateKeyError(exception)) {
      statusCode = HttpStatus.CONFLICT;
      const isEmail = isDuplicateEmailError(exception);
      const code = isEmail
        ? ErrorCode.EMAIL_ALREADY_EXISTS
        : ErrorCode.CONFLICT;
      const message = isEmail
        ? 'Email already registered'
        : 'Resource conflict occurred';
      errorResponse = ErrorResponse.error(code, message);
      this.logger.warn(
        `MongoDuplicateKeyError: code=${exception.code} keys=${describeDuplicateKeys(exception)}${tag}`,
      );
    } else {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = ErrorResponse.error(
        ErrorCode.INTERNAL_ERROR,
        'An unexpected error occurred',
      );
      // The name, code and paths can go to the log; a driver message embeds
      // the offending value, and so does the first line of the stack.
      this.logger.error(
        `Unknown exception: ${describeUnknownException(exception)}${tag}`,
        stackFrames(exception),
      );
    }

    if (requestId) {
      errorResponse.requestId = requestId;
    }

    response.status(statusCode).json(errorResponse);
  }

  /**
   * Which DTO fields a refused request failed on, for the log. Names only:
   * messages and unknown property names can carry what the caller sent.
   */
  private describeFailedFields(exception: AppException): string {
    if (!(exception instanceof ValidationFailedException)) {
      return '';
    }
    const { fieldNames, omittedCount } = exception.logSummary;
    return ` (fields: ${fieldNames.join(', ')}; omitted: ${omittedCount})`;
  }

  /**
   * Maps HTTP status codes to standardized error codes when not thrown as an AppException.
   */
  private mapHttpStatusToErrorCode(status: number): ErrorCode {
    const codes: Record<number, ErrorCode> = {
      [HttpStatus.BAD_REQUEST]: ErrorCode.INVALID_INPUT,
      [HttpStatus.UNAUTHORIZED]: ErrorCode.SESSION_INVALID,
      [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
      [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
      [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
    };
    return codes[status] ?? ErrorCode.INTERNAL_ERROR;
  }
}
