import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from '../../services/features/auth-features.service';

class PasswordSwitch extends AuthFeaturesService {
  constructor(private readonly passwordOn: boolean) {
    const config = new ConfigService({});
    super(config, browserApplicationsForTest(config));
  }

  override isEnabled(feature: AuthFeature): boolean {
    return feature === AuthFeature.PASSWORD
      ? this.passwordOn
      : super.isEnabled(feature);
  }
}

/**
 * The feature switches with password sign-in set by the case, so the same
 * cases hold in a project generated without the method.
 */
export function passwordSwitch(on: boolean): AuthFeaturesService {
  return new PasswordSwitch(on);
}
