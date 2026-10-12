// feature:totp:start
// The two-factor controller pulls in the otplib adapter; this spec only reads
// the feature metadata off the class.
jest.mock('../two-factor/utils/totp.util', () => ({
  generateTotpSecret: jest.fn(),
  buildOtpauthUrl: jest.fn(),
  checkTotpDelta: jest.fn(),
}));
// feature:totp:end

import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { FeatureEnabledGuard } from './feature-enabled.guard';
import { AuthFeaturesService } from '../services/features/auth-features.service';
import { AuthFeature } from '../enums/auth-feature.enum';
import { AUTH_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import { AuthController } from '../auth.controller';
import { MagicLinkController } from '../magic-link/magic-link.controller'; // feature:magic-link
import { TwoFactorController } from '../two-factor/two-factor.controller'; // feature:totp
import { PasskeysController } from '../passkeys/passkeys.controller'; // feature:passkeys
import { PasskeyLoginController } from '../passkeys/passkey-login.controller'; // feature:passkeys
import { ErrorCode } from '../../common/enums/error-code.enum';
import {
  createExecutionContextMock,
  handlerOf,
  type RouteHandler,
} from '../../common/testing/test-doubles.harness-spec';

class UngatedController {
  handle(): void {}
}

/** Context that reports the class and handler a request would have hit. */
function contextFor(
  target: object,
  handler: RouteHandler = () => undefined,
): ExecutionContext {
  return createExecutionContextMock({
    getClass: () => target,
    getHandler: () => handler,
  });
}

/** Configuration key each feature reads, mirroring AuthFeaturesService. */
const CONFIG_KEYS: Record<string, AuthFeature> = {
  'auth.passwordEnabled': AuthFeature.PASSWORD,
  'magicLink.enabled': AuthFeature.MAGIC_LINK,
  'twoFactor.enabled': AuthFeature.TWO_FACTOR,
  'passkeys.enabled': AuthFeature.PASSKEYS,
};

describe('FeatureEnabledGuard', () => {
  function createGuard(enabled: Partial<Record<AuthFeature, boolean>>): {
    guard: FeatureEnabledGuard;
  } {
    const values: Record<string, boolean> = {};
    for (const [key, feature] of Object.entries(CONFIG_KEYS)) {
      const flag = enabled[feature];
      if (flag !== undefined) {
        values[key] = flag;
      }
    }

    const guard = new FeatureEnabledGuard(
      new Reflector(),
      new AuthFeaturesService(new ConfigService(values)),
    );

    return { guard };
  }

  it('should let a route without feature metadata through', () => {
    const { guard } = createGuard({
      [AuthFeature.PASSWORD]: false,
      [AuthFeature.MAGIC_LINK]: false,
    });

    expect(guard.canActivate(contextFor(UngatedController))).toBe(true);
  });

  // feature:magic-link:start
  it('should let the magic link routes through when the method is on', () => {
    const { guard } = createGuard({
      [AuthFeature.PASSWORD]: true,
      [AuthFeature.MAGIC_LINK]: true,
    });

    expect(guard.canActivate(contextFor(MagicLinkController))).toBe(true);
  });

  it('should answer 404 FEATURE_DISABLED for the magic link routes when the method is off', () => {
    const { guard } = createGuard({
      [AuthFeature.PASSWORD]: true,
      [AuthFeature.MAGIC_LINK]: false,
    });

    expect(() => guard.canActivate(contextFor(MagicLinkController))).toThrow(
      expect.objectContaining({
        code: ErrorCode.FEATURE_DISABLED,
        status: 404,
      }) as Error,
    );
  });
  // feature:magic-link:end

  it('should answer 404 FEATURE_DISABLED for login when passwords are off', () => {
    const { guard } = createGuard({
      [AuthFeature.PASSWORD]: false,
      [AuthFeature.MAGIC_LINK]: true,
    });

    expect(() =>
      guard.canActivate(
        contextFor(
          AuthController,
          handlerOf(AuthController.prototype, 'login'),
        ),
      ),
    ).toThrow(
      expect.objectContaining({ code: ErrorCode.FEATURE_DISABLED }) as Error,
    );
  });

  // feature:totp:start
  it('should let the two-factor routes through when the feature is on', () => {
    const { guard } = createGuard({ [AuthFeature.TWO_FACTOR]: true });

    expect(guard.canActivate(contextFor(TwoFactorController))).toBe(true);
  });
  // feature:totp:end

  // feature:passkeys:start
  it.each([
    ['management', PasskeysController],
    ['sign-in', PasskeyLoginController],
  ])(
    'should let the passkey %s routes through when the method is on',
    (_name, controller) => {
      const { guard } = createGuard({ [AuthFeature.PASSKEYS]: true });

      expect(guard.canActivate(contextFor(controller))).toBe(true);
    },
  );

  it.each([
    ['management', PasskeysController],
    ['sign-in', PasskeyLoginController],
  ])(
    'should answer 404 FEATURE_DISABLED for the passkey %s routes when the method is off',
    (_name, controller) => {
      const { guard } = createGuard({ [AuthFeature.PASSKEYS]: false });

      expect(() => guard.canActivate(contextFor(controller))).toThrow(
        expect.objectContaining({
          code: ErrorCode.FEATURE_DISABLED,
          status: 404,
        }) as Error,
      );
    },
  );
  // feature:passkeys:end

  // feature:totp:start
  it('should answer 404 FEATURE_DISABLED for the two-factor routes when the feature is off', () => {
    const { guard } = createGuard({ [AuthFeature.TWO_FACTOR]: false });

    expect(() => guard.canActivate(contextFor(TwoFactorController))).toThrow(
      expect.objectContaining({
        code: ErrorCode.FEATURE_DISABLED,
        status: 404,
      }) as Error,
    );
  });
  // feature:totp:end
});

describe('password route gating', () => {
  const reflector = new Reflector();

  it.each([
    'register',
    'activate',
    'resendActivation',
    'login',
    'forgotPassword',
    'resetPassword',
  ])('should tie %s to the password method', (handler) => {
    expect(
      reflector.get(
        AUTH_FEATURE_KEY,
        handlerOf(AuthController.prototype, handler),
      ),
    ).toBe(AuthFeature.PASSWORD);
  });

  it.each(['logout'])(
    'should leave %s open, since it does not need a password',
    (handler) => {
      expect(
        reflector.get(
          AUTH_FEATURE_KEY,
          handlerOf(AuthController.prototype, handler),
        ),
      ).toBeUndefined();
    },
  );

  // feature:magic-link:start
  it('should tie the whole magic link controller to the magic link method', () => {
    expect(reflector.get(AUTH_FEATURE_KEY, MagicLinkController)).toBe(
      AuthFeature.MAGIC_LINK,
    );
  });
  // feature:magic-link:end
});
