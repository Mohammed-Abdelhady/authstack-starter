import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { StoredSession } from '../../authority/session-authority.store';
import {
  SessionValidator,
  ValidatedSession,
} from '../../authority/session-validator';
import { leanSessionOf, leanUserOf } from './mongo-session-records';
import { LeanSession } from './schemas/session.schema';

export interface ValidateSessionOptions {
  extendIdle?: boolean;
}

/**
 * The MongoDB face of session validation, for callers that still hold Mongoose
 * ids and read Mongoose documents. Every decision is `SessionValidator`'s; this
 * hands back the documents behind what it decided. It goes away when the guard
 * and the account module read sessions and accounts through stores.
 */
@Injectable()
export class SessionAuthorityService {
  constructor(private readonly validator: SessionValidator) {}

  async validate(
    token: string,
    options: ValidateSessionOptions = {},
  ): Promise<LeanSession | null> {
    return withAccount(
      await this.validator.validateByToken(token, options.extendIdle !== false),
    );
  }

  async listActive(userId: Types.ObjectId): Promise<LeanSession[]> {
    const sessions = await this.validator.listActive(userId.toString());
    return sessions.map(leanSessionOf);
  }

  async getById(sessionId: string): Promise<LeanSession | null> {
    return leanOrNull(await this.validator.findById(sessionId));
  }

  async getByToken(token: string): Promise<LeanSession | null> {
    return leanOrNull(await this.validator.findByToken(token));
  }

  async validateById(
    sessionId: Types.ObjectId,
    extendIdle: boolean,
  ): Promise<LeanSession | null> {
    return withAccount(
      await this.validator.validateById(sessionId.toString(), extendIdle),
    );
  }
}

function leanOrNull(stored: StoredSession | null): LeanSession | null {
  return stored ? leanSessionOf(stored) : null;
}

function withAccount(validated: ValidatedSession | null): LeanSession | null {
  if (!validated) {
    return null;
  }
  const lean = leanSessionOf(validated.session);
  if (validated.extended) {
    lean.lastUsedAt = validated.session.lastUsedAt ?? undefined;
    lean.lastActivityAt = validated.session.lastActivityAt;
    lean.idleExpiresAt = validated.session.idleExpiresAt;
  }
  lean.user = leanUserOf(validated.account);
  return lean;
}
