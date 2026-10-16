import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_NAME } from '../../../common/constants/app';
import { UserVerificationRequirement } from '../constants/passkeys.constants';
import {
  AttestationExpectations,
  CeremonyExpectations,
} from './webauthn.adapter';

/**
 * Relying party settings, in one place because both ceremonies and both verify
 * routes have to agree on them. A credential is bound to the RP id it was
 * registered under, so these values are effectively permanent once accounts
 * hold passkeys.
 */
@Injectable()
export class PasskeyConfigService {
  constructor(private readonly configService: ConfigService) {}

  /** Domain the credential is scoped to. A bare hostname, no port, no scheme. */
  get rpId(): string {
    return this.configService.get<string>('passkeys.rpId', 'localhost');
  }

  /** What the browser shows in the prompt. */
  get rpName(): string {
    return this.configService.get<string>('passkeys.rpName', APP_NAME);
  }

  /** Origin the browser must be on, scheme and port included. */
  get origin(): string {
    return this.configService.get<string>(
      'passkeys.origin',
      'http://localhost:3000',
    );
  }

  expectations(challenge: string): CeremonyExpectations {
    return { challenge, origin: this.origin, rpId: this.rpId };
  }

  /** What a browser registration must have been made for. */
  attestationExpectations(
    challenge: string,
    userVerification: UserVerificationRequirement,
  ): AttestationExpectations {
    return {
      challenge,
      origins: [this.origin],
      rpId: this.rpId,
      userVerification,
    };
  }
}
