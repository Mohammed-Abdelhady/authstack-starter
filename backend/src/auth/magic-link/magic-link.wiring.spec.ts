// feature:totp:start
// AuthModule reaches the otplib adapter through the two-factor services; this
// spec only reads module metadata.
jest.mock('../two-factor/utils/totp.util', () => ({
  generateTotpSecret: jest.fn(),
  buildOtpauthUrl: jest.fn(),
  checkTotpDelta: jest.fn(),
}));
// feature:totp:end

import { MODULE_METADATA } from '@nestjs/common/constants';
import { MagicLinkModule } from './magic-link.module';
import { MagicLinkController } from './magic-link.controller';
import { MagicLinkService } from './magic-link.service';
import { AuthModule } from '../auth.module';
import { AuthMailService } from '../services/mail/auth-mail.service';
import { AuthFeaturesService } from '../services/features/auth-features.service';
import { SessionService } from '../persistence/mongo/session.service';
import { SessionCookieService } from '../services/sessions/session-cookie.service';
import { SignInService } from '../persistence/mongo/sign-in.service';
import { FeatureEnabledGuard } from '../guards/feature-enabled.guard';

/**
 * The part of the boot check that does not need a database: the magic link
 * module carrying its own routes, and AuthModule handing out everything that
 * module and its guard resolve through the parent injector.
 */

function metadataOf(module: object, key: string): unknown[] {
  return (Reflect.getMetadata(key, module) as unknown[] | undefined) ?? [];
}

describe('Magic link wiring', () => {
  it('registers the routes and the service in the module', () => {
    expect(metadataOf(MagicLinkModule, MODULE_METADATA.CONTROLLERS)).toContain(
      MagicLinkController,
    );
    expect(metadataOf(MagicLinkModule, MODULE_METADATA.PROVIDERS)).toContain(
      MagicLinkService,
    );
  });

  it('takes sessions, mail and the feature switch from AuthModule', () => {
    expect(metadataOf(MagicLinkModule, MODULE_METADATA.IMPORTS)).toContain(
      AuthModule,
    );
  });

  it.each([
    ['AuthMailService', AuthMailService],
    ['AuthFeaturesService', AuthFeaturesService],
    ['SessionService', SessionService],
    ['SessionCookieService', SessionCookieService],
    ['SignInService', SignInService],
    ['FeatureEnabledGuard', FeatureEnabledGuard],
  ])('exports %s from AuthModule', (_name, provider) => {
    expect(metadataOf(AuthModule, MODULE_METADATA.EXPORTS)).toContain(provider);
  });
});
