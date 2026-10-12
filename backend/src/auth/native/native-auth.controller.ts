import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { NativeAttemptStart } from '@app/sdk';
import { ApiResponse } from '../../common/dto/api-response.dto';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { Public } from '../decorators/public.decorator';
import { SkipBrowserProof } from '../decorators/skip-browser-proof.decorator';
import { NativeAttemptService } from './services/native-attempt.service';
import { NativeConsentService } from './services/native-consent.service';
import { NativeMethodsService } from './services/native-methods.service';
import { NATIVE_ATTEMPT_HEADER } from './constants/native-attempt';

@Public()
@SkipBrowserProof()
@Controller('auth/native')
export class NativeAuthController {
  constructor(
    private readonly attempts: NativeAttemptService,
    private readonly consent: NativeConsentService,
    private readonly methods: NativeMethodsService,
  ) {}

  @Get('methods')
  async methodsForClient(
    @Req() request: Request,
    @Query('clientId') clientId: string,
  ) {
    rejectBrowserContext(request);
    if (typeof clientId !== 'string' || !clientId || clientId.length > 128)
      throw invalidRequest();
    return ApiResponse.success(await this.methods.forClient(clientId));
  }

  @Post('attempts')
  async start(@Req() request: Request, @Body() body: unknown) {
    rejectBrowserContext(request);
    if (!isStart(body)) throw invalidRequest();
    return ApiResponse.success(await this.attempts.start(body));
  }

  @Get('attempts/:attemptId')
  async resume(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(await this.consent.resume(attemptId, secret));
  }

  @Post('attempts/:attemptId/consent')
  async approve(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(await this.consent.consent(attemptId, secret));
  }

  @Post('attempts/:attemptId/cancel')
  async cancel(
    @Req() request: Request,
    @Param('attemptId') attemptId: string,
    @Headers(NATIVE_ATTEMPT_HEADER) secret: string,
  ) {
    rejectBrowserContext(request);
    return ApiResponse.success(await this.attempts.cancel(attemptId, secret));
  }
}

function rejectBrowserContext(request: Request): void {
  if (
    request.headers.origin !== undefined ||
    request.headers.cookie !== undefined
  ) {
    throw new AppException(
      ErrorCode.FORBIDDEN,
      'Browser context not accepted',
      403,
    );
  }
}

function isStart(input: unknown): input is NativeAttemptStart {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  const required = [
    'clientId',
    'redirectUri',
    'codeChallenge',
    'codeChallengeMethod',
    'state',
    'scopes',
    'flow',
  ];
  if (Object.keys(record).some((key) => !required.includes(key))) return false;
  if (required.some((key) => !(key in record))) return false;
  return (
    typeof record.clientId === 'string' &&
    typeof record.redirectUri === 'string' &&
    typeof record.codeChallenge === 'string' &&
    record.codeChallengeMethod === 'S256' &&
    typeof record.state === 'string' &&
    Array.isArray(record.scopes) &&
    record.scopes.length <= 64 &&
    record.scopes.every((scope: unknown) => typeof scope === 'string') &&
    ['signIn', 'registration', 'recovery'].includes(String(record.flow))
  );
}

function invalidRequest(): AppException {
  return new AppException(
    ErrorCode.VALIDATION_ERROR,
    'Invalid native request',
    400,
  );
}
