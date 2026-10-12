import { Injectable } from '@nestjs/common';
import {
  AccountIdentity,
  SessionAuthorityStore,
  StoredSession,
} from './session-authority.store';
import { ValidatedSession } from './session-validator';

/**
 * A session that holds authority, with the account it speaks for. This is what
 * a request carries once a guard has let it in.
 */
export interface AuthenticatedSession extends StoredSession {
  user: AccountIdentity | null;
}

/** Names the account behind a session the validator accepted. */
@Injectable()
export class AuthenticatedSessions {
  constructor(private readonly store: SessionAuthorityStore) {}

  async of(
    validated: ValidatedSession | null,
  ): Promise<AuthenticatedSession | null> {
    if (!validated) {
      return null;
    }
    return {
      ...validated.session,
      user: await this.store.describeAccount(validated.account),
    };
  }
}
