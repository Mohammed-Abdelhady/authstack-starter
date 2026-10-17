import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_NAME } from '../../../common/constants/app';

/**
 * The web relying party's settings, which the application policy reader hands
 * the web application, and the name every prompt shows. A credential is bound
 * to the RP id it was registered under, so these values are effectively
 * permanent once accounts hold passkeys.
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
}
