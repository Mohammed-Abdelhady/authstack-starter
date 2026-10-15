import { ConfigService } from '@nestjs/config';
import { BrowserApplications } from '../../session/applications/browser-applications';
import type { BrowserApplicationEnabledReader } from '../../session/applications/types/browser-application';

/** Controlled availability for existing tests of browser decisions, not storage. */
export function browserApplicationsForTest(
  config: ConfigService = new ConfigService({}),
  readEnabled: BrowserApplicationEnabledReader = () => Promise.resolve(true),
): BrowserApplications {
  return new BrowserApplications(config, readEnabled);
}

export const BROWSER_APPLICATIONS_TEST_PROVIDER = {
  provide: BrowserApplications,
  inject: [ConfigService],
  useFactory: (config: ConfigService) => browserApplicationsForTest(config),
};
