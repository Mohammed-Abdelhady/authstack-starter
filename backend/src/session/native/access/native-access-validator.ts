import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';
import { Clock } from '../../../common/services/clock';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import {
  SessionValidator,
  ValidatedSession,
} from '../../authority/session-validator';
import { hashToken } from '../../utils/hashing/token-hash';
import {
  FIRST_USE,
  NativeAccessStore,
} from '../credentials/native-access.store';

/**
 * Validates a mobile access token: the token itself, then its session with the
 * rule every session answers to. A token bound to a device key is marked on
 * its first use, which is what stops a retry from replacing a pair in use.
 */
@Injectable()
export class NativeAccessValidator {
  constructor(
    private readonly store: NativeAccessStore,
    private readonly sessions: SessionValidator,
    private readonly clock: Clock,
    private readonly authEpoch: AuthEpochService,
  ) {}

  async validate(rawToken: string): Promise<ValidatedSession | null> {
    if (!this.authEpoch.nativeEnabled()) {
      throw new AppException(
        ErrorCode.NATIVE_AUTH_DISABLED,
        'Native authentication is disabled',
        HttpStatus.FORBIDDEN,
      );
    }
    const now = this.clock.now();
    const credential = await this.store.readCommittedAccessCredential(
      hashToken(rawToken),
      now,
    );
    if (!credential) {
      return null;
    }
    const validated = await this.sessions.validateById(
      credential.sessionId,
      true,
    );
    if (!validated) {
      return null;
    }
    if (credential.proofKeyThumbprint || validated.session.proofKeyThumbprint) {
      const marked = await this.store.markFirstUse(credential.id, now);
      if (
        marked === FIRST_USE.NOT_MARKED &&
        !(await this.store.readCommittedAccessIsLive(
          credential.id,
          this.clock.now(),
        ))
      ) {
        return null;
      }
    }
    return validated;
  }
}
