// The controller pulls in the otplib adapter; this spec only reads metadata.
jest.mock('./utils/totp.util', () => ({
  generateTotpSecret: jest.fn(),
  buildOtpauthUrl: jest.fn(),
  checkTotpDelta: jest.fn(),
}));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { TwoFactorModule } from './two-factor.module';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { TwoFactorLoginService } from './two-factor-login.service';
import { AuthModule } from '../auth.module';
import { AuthFeature } from '../enums/auth-feature.enum';
import { AUTH_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SignInService } from '../persistence/mongo/sign-in.service';
import { TwoFactorChallengeService } from './services/two-factor-challenge.service';
import { TotpSecretCryptoService } from './services/totp-secret-crypto.service';
import { TwoFactorVerificationService } from './services/two-factor-verification.service';
import { handlerOf } from '../../common/testing/test-doubles.harness-spec';

/**
 * The part of the boot check that does not need a database: the two-factor
 * module carrying its own routes, and AuthModule handing out the pieces the
 * sign-in paths share with it.
 */

function metadataOf(module: object, key: string): unknown[] {
  return (Reflect.getMetadata(key, module) as unknown[] | undefined) ?? [];
}

describe('Two-factor wiring', () => {
  const reflector = new Reflector();

  it('registers the routes and both services in the module', () => {
    expect(metadataOf(TwoFactorModule, MODULE_METADATA.CONTROLLERS)).toContain(
      TwoFactorController,
    );
    expect(metadataOf(TwoFactorModule, MODULE_METADATA.PROVIDERS)).toEqual(
      expect.arrayContaining([TwoFactorService, TwoFactorLoginService]),
    );
  });

  it('takes the shared sign-in pieces from AuthModule', () => {
    expect(metadataOf(TwoFactorModule, MODULE_METADATA.IMPORTS)).toContain(
      AuthModule,
    );
  });

  it.each([
    ['SignInService', SignInService],
    ['TwoFactorChallengeService', TwoFactorChallengeService],
    ['TotpSecretCryptoService', TotpSecretCryptoService],
    ['TwoFactorVerificationService', TwoFactorVerificationService],
  ])('exports %s from AuthModule', (_name, provider) => {
    expect(metadataOf(AuthModule, MODULE_METADATA.EXPORTS)).toContain(provider);
  });

  it('ties the whole controller to the two-factor feature', () => {
    expect(reflector.get(AUTH_FEATURE_KEY, TwoFactorController)).toBe(
      AuthFeature.TWO_FACTOR,
    );
  });

  it('leaves verify open, since the caller has no session yet', () => {
    expect(
      reflector.get(
        IS_PUBLIC_KEY,
        handlerOf(TwoFactorController.prototype, 'verify'),
      ),
    ).toBe(true);
  });

  it.each(['setup', 'confirm', 'disable', 'regenerateRecoveryCodes'])(
    'keeps %s behind a session',
    (handler) => {
      expect(
        reflector.get(
          IS_PUBLIC_KEY,
          handlerOf(TwoFactorController.prototype, handler),
        ),
      ).toBeUndefined();
    },
  );
});
