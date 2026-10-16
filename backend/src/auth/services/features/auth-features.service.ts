import type { Request } from 'express';
import { FeatureApplications } from '../../contracts/feature-applications';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AVAILABLE_AUTH_FEATURES } from '../../constants/available-auth-features';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/enums/error-code.enum';

/** Configuration key holding the switch for each feature. */
const FEATURE_CONFIG_KEYS: Record<AuthFeature, string> = {
  [AuthFeature.PASSWORD]: 'auth.passwordEnabled',
  [AuthFeature.MAGIC_LINK]: 'magicLink.enabled',
  [AuthFeature.TWO_FACTOR]: 'twoFactor.enabled',
  [AuthFeature.PASSKEYS]: 'passkeys.enabled',
};

/** Used when the key is absent, which happens in tests with a partial config. */
const FEATURE_FALLBACKS: Record<AuthFeature, boolean> = {
  [AuthFeature.PASSWORD]: true,
  [AuthFeature.MAGIC_LINK]: false,
  [AuthFeature.TWO_FACTOR]: true,
  [AuthFeature.PASSKEYS]: true,
};

/**
 * Single answer to "is this feature on?", read by the guard that closes the
 * routes and by the discovery endpoint that lists them.
 */
@Injectable()
export class AuthFeaturesService {
  constructor(
    private readonly configService: ConfigService,
    private readonly applications: FeatureApplications,
  ) {}

  async assertForRequest(
    feature: AuthFeature,
    request?: Request,
  ): Promise<void> {
    if (!request) {
      this.assertEnabled(feature);
      return;
    }
    if (!this.applications.isBrowserRequest(request)) {
      this.assertEnabled(feature);
      return;
    }
    const application = await this.applications.resolve(request);
    this.applications.assertEnabled(application);
    this.assertEnabled(feature, application.clientId);
  }

  isEnabledForRequest(feature: AuthFeature, request?: Request): boolean {
    return this.isEnabled(
      feature,
      request ? this.applications.current(request).clientId : undefined,
    );
  }

  isEnabled(feature: AuthFeature, clientId?: string): boolean {
    if (clientId) {
      const policy = this.applications.configuration(clientId).signIn;
      if (feature === AuthFeature.PASSWORD && policy?.password === false) {
        return false;
      }
      if (feature === AuthFeature.MAGIC_LINK && policy?.emailLink === false) {
        return false;
      }
      if (feature === AuthFeature.PASSKEYS && policy?.passkeys === false) {
        return false;
      }
    }
    if (!AVAILABLE_AUTH_FEATURES.has(feature)) return false;

    return this.configService.get<boolean>(
      FEATURE_CONFIG_KEYS[feature],
      FEATURE_FALLBACKS[feature],
    );
  }

  /**
   * @throws AppException FEATURE_DISABLED with a 404, so a deployment that
   * turned the method off looks like one that never had the route
   */
  assertEnabled(feature: AuthFeature, clientId?: string): void {
    if (this.isEnabled(feature, clientId)) {
      return;
    }

    throw new AppException(
      ErrorCode.FEATURE_DISABLED,
      'This sign-in method is not available',
      HttpStatus.NOT_FOUND,
      { feature },
    );
  }
}
