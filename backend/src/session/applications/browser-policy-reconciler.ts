import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readBrowserSessionLimits } from '../../config/utils/session-limit-config';
import { EventRecorder } from '../../auth/contracts/event-recorder';
import { runLeavingFailuresAsRaised } from '../../common/persistence/store-failure';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { AuthEpochService } from '../../common/services/auth-epoch.service';
import {
  BROWSER_SIGN_IN_METHODS,
  SIGN_UP_POLICY,
} from '../../config/constants/host-contracts';
import type { BrowserSignInConfiguration } from '../../config/types/host-policy.type';
import {
  ADMIN_CLIENT_ID,
  APPLICATION_CLIENT_TYPE,
  APPLICATION_PLATFORM,
  DEFAULT_API_AUDIENCE,
  WEB_CLIENT_ID,
} from '../constants/client-ids';
import {
  ADMIN_ABSOLUTE_LIFETIME_MS,
  ADMIN_IDLE_LIFETIME_MS,
  WEB_ABSOLUTE_LIFETIME_MS,
  WEB_IDLE_LIFETIME_MS,
} from '../constants/session-policy';
import { SECURITY_EVENT_ACTION } from '../constants/security-event-action';
import {
  ApplicationRegistryStore,
  StoredRegistration,
} from './application-registry.store';
import { BrowserApplications } from './browser-applications';
import type {
  BrowserApplication,
  BrowserApplicationId,
} from './types/browser-application';
import type { ApplicationSignInMethods } from './types/application-sign-in-methods';
import type { BrowserRegistration } from './types/browser-registration';

function methodSnapshot(
  signIn: BrowserSignInConfiguration | undefined,
): ApplicationSignInMethods | null {
  if (!signIn) return null;
  const snapshot: BrowserSignInConfiguration = {};
  for (const method of BROWSER_SIGN_IN_METHODS) {
    const enabled = signIn[method];
    if (enabled !== undefined) snapshot[method] = enabled;
  }
  return snapshot;
}

function policyChanged(
  stored: StoredRegistration,
  application: Pick<BrowserApplication, 'signIn'>,
): boolean {
  return (
    stored.signUp !== (application.signIn?.signUp ?? SIGN_UP_POLICY.OPEN) ||
    stored.requirePasskey !== (application.signIn?.requirePasskey ?? false) ||
    stored.accountAudience !== application.signIn?.audience ||
    BROWSER_SIGN_IN_METHODS.some(
      (method) =>
        (stored.signInMethods?.[method] ?? true) !==
        (application.signIn?.[method] ?? true),
    )
  );
}

function initialPolicy(clientId: BrowserApplicationId) {
  return clientId === ADMIN_CLIENT_ID
    ? {
        absoluteLifetimeMs: ADMIN_ABSOLUTE_LIFETIME_MS,
        idleLifetimeMs: ADMIN_IDLE_LIFETIME_MS,
      }
    : {
        absoluteLifetimeMs: WEB_ABSOLUTE_LIFETIME_MS,
        idleLifetimeMs: WEB_IDLE_LIFETIME_MS,
      };
}

@Injectable()
export class BrowserPolicyReconciler {
  constructor(
    private readonly runner: UnitOfWorkRunner,
    private readonly store: ApplicationRegistryStore,
    private readonly applications: BrowserApplications,
    private readonly authEpoch: AuthEpochService,
    private readonly events: EventRecorder,
    private readonly config: ConfigService,
  ) {}

  async reconcile(): Promise<void> {
    const environment = this.authEpoch.environment();
    const configured = [this.applications.configuration(WEB_CLIENT_ID)];
    if (this.applications.isConfigured(ADMIN_CLIENT_ID)) {
      configured.push(this.applications.configuration(ADMIN_CLIENT_ID));
    }
    const limitsByClient = new Map(
      configured.map(
        ({ clientId }) =>
          [clientId, readBrowserSessionLimits(this.config, clientId)] as const,
      ),
    );
    await runLeavingFailuresAsRaised(this.runner, async (work) => {
      const stored = new Map(
        (
          await this.store.takeRegistrations(
            work,
            environment,
            configured.map(({ clientId }) => clientId),
          )
        ).map((application) => [application.clientId, application]),
      );
      for (const application of configured) {
        const found = stored.get(application.clientId);
        const platform =
          application.clientId === ADMIN_CLIENT_ID
            ? APPLICATION_PLATFORM.ADMIN
            : APPLICATION_PLATFORM.WEB;
        const clientType =
          application.clientId === ADMIN_CLIENT_ID
            ? APPLICATION_CLIENT_TYPE.CONFIDENTIAL
            : APPLICATION_CLIENT_TYPE.PUBLIC;
        if (
          found &&
          (found.platform !== platform || found.clientType !== clientType)
        ) {
          throw new Error(
            `Browser application ${application.clientId} belongs to another kind; choose a distinct native clientId.`,
          );
        }
        const changed =
          found !== undefined && policyChanged(found, application);
        const version = found?.policyVersion ?? 0;
        const enabled =
          application.clientId === ADMIN_CLIENT_ID
            ? true
            : this.config.get<boolean>('auth.web.enabledExplicit', false)
              ? this.config.get<boolean>('auth.web.enabled', true)
              : undefined;
        const limits = limitsByClient.get(application.clientId);
        const registration: BrowserRegistration = {
          clientId: application.clientId,
          environment,
          displayName:
            application.clientId === ADMIN_CLIENT_ID ? 'Admin' : 'Web',
          platform,
          clientType,
          allowedOrigins: [application.origin],
          initialAudiences: [DEFAULT_API_AUDIENCE],
          initialScopes: [DEFAULT_API_AUDIENCE],
          policy: limits?.policy ?? initialPolicy(application.clientId),
          sessionCap: limits?.sessionCap,
          expectedPolicyVersion: found ? version : null,
          policyVersion: version + Number(changed),
          signUp: application.signIn?.signUp ?? SIGN_UP_POLICY.OPEN,
          requirePasskey: application.signIn?.requirePasskey ?? false,
          signInMethods: methodSnapshot(application.signIn),
          accountAudience: application.signIn?.audience ?? null,
          ...(enabled === undefined ? {} : { enabled }),
        };
        await this.store.storeBrowserRegistration(work, registration);
        if (changed) {
          await this.events.record(work, {
            clientId: application.clientId,
            action: SECURITY_EVENT_ACTION.POLICY_CHANGED,
          });
        }
      }
    });
  }
}
