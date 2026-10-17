import { browserApplicationsForTest } from '../../../common/testing/browser-applications.harness-spec';
import { ConfigService } from '@nestjs/config';
import { AuthFeature } from '../../enums/auth-feature.enum';
import { AuthFeaturesService } from './auth-features.service';

jest.mock('../../constants/available-auth-features', () => ({
  AVAILABLE_AUTH_FEATURES: new Set(['password']),
}));

describe('AuthFeaturesService in a generated project', () => {
  it('should refuse removed methods even when their runtime flag is on', () => {
    const get = jest.fn().mockReturnValue(true);
    const config = Object.assign(new ConfigService(), { get });
    const browserApplications = browserApplicationsForTest(config);
    const service = new AuthFeaturesService(config, browserApplications);

    for (const feature of [
      AuthFeature.MAGIC_LINK,
      AuthFeature.TWO_FACTOR,
      AuthFeature.PASSKEYS,
    ]) {
      expect(service.isEnabled(feature)).toBe(false);
      expect(() => service.assertEnabled(feature)).toThrow(
        'This sign-in method is not available',
      );
    }
    expect(get).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'should respect a retained method flag of %s',
    (enabled) => {
      const get = jest.fn().mockReturnValue(enabled);
      const config = Object.assign(new ConfigService(), { get });
      const browserApplications = browserApplicationsForTest(config);
      const service = new AuthFeaturesService(config, browserApplications);

      expect(service.isEnabled(AuthFeature.PASSWORD)).toBe(enabled);
      expect(get).toHaveBeenCalledWith('auth.passwordEnabled', true);
    },
  );
});
