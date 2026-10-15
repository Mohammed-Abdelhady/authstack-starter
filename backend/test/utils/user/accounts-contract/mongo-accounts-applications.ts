import type { ApplicationPolicyConfiguration } from '../../../../src/config/types/host-policy.type';
import { SIGN_UP_POLICY } from '../../../../src/config/constants/host-contracts';
import { IssuanceApplications } from '../../../../src/session/issuance/issuance-applications';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
  WEB_CLIENT_ID,
} from '../../../../src/session/constants/client-ids';
import {
  ADMIN_ABSOLUTE_LIFETIME_MS,
  ADMIN_IDLE_LIFETIME_MS,
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../../../../src/session/constants/session-policy';
import type { SessionAuthorityHarness } from '../../session-authority-harness';
import { CONTRACT_ENVIRONMENT } from '../../session/issuance-contract/issuance-contract-harness';

export function mongoAccountsApplications(booted: SessionAuthorityHarness) {
  const configureCreationApplication = async (
    clientId: string,
    policy: ApplicationPolicyConfiguration,
  ): Promise<void> => {
    const admin = clientId === ADMIN_CLIENT_ID;
    await booted.applications
      .updateOne(
        { clientId, environment: CONTRACT_ENVIRONMENT },
        {
          $set: {
            displayName: clientId,
            platform: admin
              ? APPLICATION_PLATFORM.ADMIN
              : clientId === WEB_CLIENT_ID
                ? APPLICATION_PLATFORM.WEB
                : APPLICATION_PLATFORM.NATIVE,
            clientType: admin
              ? APPLICATION_CLIENT_TYPE.CONFIDENTIAL
              : APPLICATION_CLIENT_TYPE.PUBLIC,
            enabled: true,
            signUp: policy.signUp ?? SIGN_UP_POLICY.OPEN,
            requirePasskey: policy.requirePasskey ?? false,
            ...(policy.audience === undefined
              ? {}
              : { accountAudience: policy.audience }),
            policy: {
              absoluteLifetimeMs: admin
                ? ADMIN_ABSOLUTE_LIFETIME_MS
                : WEB_ABSOLUTE_LIFETIME_MS,
              idleLifetimeMs: admin
                ? ADMIN_IDLE_LIFETIME_MS
                : WEB_IDLE_LIFETIME_MS,
            },
            allowedScopes: [DEFAULT_API_AUDIENCE],
            audiences: [DEFAULT_API_AUDIENCE],
          },
          ...(policy.audience === undefined
            ? { $unset: { accountAudience: 1 } }
            : {}),
          $setOnInsert: {
            clientId,
            environment: CONTRACT_ENVIRONMENT,
            sessionVersion: 0,
            policyVersion: 0,
          },
        },
        { upsert: true },
      )
      .exec();
  };
  return {
    issuanceApplications: booted.app.get(IssuanceApplications),
    configureCreationApplication,
    seedCreationApplications: async (): Promise<void> => {
      await configureCreationApplication(WEB_CLIENT_ID, {});
      await configureCreationApplication(ADMIN_CLIENT_ID, {});
    },
  };
}
