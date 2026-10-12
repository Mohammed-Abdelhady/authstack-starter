import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { NATIVE_ACCESS_TOKEN_TYPE } from '../../constants/session-policy';
import {
  AuthenticatedSession,
  AuthenticatedSessions,
} from '../../authority/authenticated-session';
import { NativeAccessValidator } from './native-access-validator';

const BEARER_MAX_LENGTH = 256;

export function readBearerToken(request: Request): string | null {
  const header = request.headers?.authorization;
  if (typeof header !== 'string') {
    return null;
  }
  const separator = header.indexOf(' ');
  if (separator <= 0) {
    return null;
  }
  const scheme = header.slice(0, separator);
  const token = header.slice(separator + 1).trim();
  if (
    scheme !== NATIVE_ACCESS_TOKEN_TYPE ||
    token.length === 0 ||
    token.length > BEARER_MAX_LENGTH
  ) {
    return null;
  }
  return token;
}

/** Validates a mobile access token and names the account it speaks for. */
@Injectable()
export class NativeAccessService {
  constructor(
    private readonly validator: NativeAccessValidator,
    private readonly authenticated: AuthenticatedSessions,
  ) {}

  async validate(rawToken: string): Promise<AuthenticatedSession | null> {
    return this.authenticated.of(await this.validator.validate(rawToken));
  }
}
