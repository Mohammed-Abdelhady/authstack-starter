import { SignInNoticeService } from './notices/sign-in-notice.service';
import { MailModule } from '../mail/mail.module';
import { EnrolmentPromotion } from '../auth/contracts/enrolment-promotion';
import { NoopEnrolmentPromotion } from '../auth/contracts/defaults/noop-enrolment-promotion';
import { EnrolmentStore } from './enrolment/enrolment.store';
import { SessionEnrolmentPromotion } from './enrolment/session-enrolment-promotion'; // feature:passkeys
import { AudienceMappingAudit } from '../user/services/audience-mapping-audit';
import {
  AUDIENCE_MAPPING_IMPORTS,
  AUDIENCE_MAPPING_PROVIDERS,
} from '../user/persistence/audience-mapping-persistence';
import { AudiencePolicy } from './applications/audience-policy';
import { BrowserPolicyReconciler } from './applications/browser-policy-reconciler';
import { Module, OnModuleInit, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommonModule } from '../common/common.module';
import { AuthFeaturesService } from '../auth/services/features/auth-features.service';
import { PasskeyConfigService } from '../auth/passkeys/services/passkey-config.service'; // feature:passkeys
import { StoredApplicationPolicyReader } from './applications/stored-application-policy-reader';
import { ApplicationPolicyReader } from '../auth/contracts/application-policy';
import { EventRecorder } from '../auth/contracts/event-recorder';
import { FeatureApplications } from '../auth/contracts/feature-applications';
import { StorageStartup } from '../common/persistence/storage-startup';
import { UnitOfWorkRunner } from '../common/persistence/unit-of-work';
import { ApplicationAccess } from './applications/application-access';
import { ApplicationAccessStore } from './applications/application-access.store';
import { BrowserApplications } from './applications/browser-applications';
import { ApplicationRegistry } from './applications/application-registry';
import { ApplicationRegistryStore } from './applications/application-registry.store';
import { AuthorityApplications } from './authority/authority-applications';
import { AuthenticatedSessions } from './authority/authenticated-session';
import { SessionAuthorityStore } from './authority/session-authority.store';
import { SessionExpiry } from './authority/session-expiry';
import { SessionValidator } from './authority/session-validator';
import { SecurityEventRecorder } from './events/security-event-recorder';
import { SecurityEventStore } from './events/security-event.store';
import { BrowserIssuanceStore } from './issuance/browser-issuance.store';
import { IssuanceApplications } from './issuance/issuance-applications';
import { BrowserProofStore } from './proofs/browser-proof.store';
import { SessionRevocationStore } from './revocation/session-revocation.store';
import { SessionRevoker } from './revocation/session-revoker';
import { BrowserProofService } from './services/browser-proof.service';
import { NativeSessionRevocationService } from './services/native-session-revocation.service';
import { SessionIssuanceService } from './services/session-issuance.service';
import { NativeAccessService } from './native/access/native-access.service';
import { NativeAccessValidator } from './native/access/native-access-validator';
import { NativeAccessStore } from './native/credentials/native-access.store';
import { NativeCredentialStore } from './native/credentials/native-credential.store';
import { NativeSecurityEvents } from './native/credentials/native-security-events';
import {
  SESSION_PERSISTENCE_EXPORTS,
  SESSION_PERSISTENCE_IMPORTS,
  SESSION_PERSISTENCE_PROVIDERS,
} from './persistence/session-persistence';

@Module({
  imports: [
    CommonModule,
    MailModule,
    ...SESSION_PERSISTENCE_IMPORTS,
    ...AUDIENCE_MAPPING_IMPORTS,
  ],
  providers: [
    SignInNoticeService,
    {
      ...{ provide: EnrolmentPromotion, useClass: NoopEnrolmentPromotion },
      useClass: SessionEnrolmentPromotion, // feature:passkeys
    },
    {
      provide: ApplicationPolicyReader,
      useClass: StoredApplicationPolicyReader,
    },
    AuthFeaturesService,
    PasskeyConfigService, // feature:passkeys
    { provide: EventRecorder, useExisting: SecurityEventRecorder },
    ...SESSION_PERSISTENCE_PROVIDERS,
    ...AUDIENCE_MAPPING_PROVIDERS,
    AudienceMappingAudit,
    {
      provide: BrowserApplications,
      inject: [ConfigService, ApplicationRegistry],
      useFactory: (config: ConfigService, registry: ApplicationRegistry) =>
        new BrowserApplications(
          config,
          async (clientId) =>
            (await registry.findByClientId(clientId))?.enabled ?? false,
        ),
    },
    { provide: FeatureApplications, useExisting: BrowserApplications },
    AudiencePolicy,
    BrowserPolicyReconciler,
    ApplicationRegistry,
    ApplicationAccess,
    BrowserProofService,
    NativeSessionRevocationService,
    SecurityEventRecorder,
    SessionIssuanceService,
    SessionExpiry,
    SessionValidator,
    AuthenticatedSessions,
    SessionRevoker,
    NativeAccessValidator,
    NativeAccessService,
  ],
  exports: [
    SignInNoticeService,
    EnrolmentPromotion,
    EnrolmentStore,
    ApplicationPolicyReader,
    EventRecorder,
    ...SESSION_PERSISTENCE_EXPORTS,
    CommonModule,
    ApplicationRegistryStore,
    BrowserApplications,
    FeatureApplications,
    AudiencePolicy,
    BrowserPolicyReconciler,
    ApplicationRegistry,
    ApplicationAccessStore,
    ApplicationAccess,
    BrowserProofStore,
    BrowserProofService,
    NativeSessionRevocationService,
    SecurityEventStore,
    SecurityEventRecorder,
    UnitOfWorkRunner,
    StorageStartup,
    BrowserIssuanceStore,
    IssuanceApplications,
    SessionIssuanceService,
    SessionAuthorityStore,
    AuthorityApplications,
    SessionExpiry,
    SessionValidator,
    AuthenticatedSessions,
    SessionRevocationStore,
    SessionRevoker,
    NativeCredentialStore,
    NativeAccessStore,
    NativeSecurityEvents,
    NativeAccessValidator,
    NativeAccessService,
  ],
})
export class SessionModule implements OnModuleInit {
  constructor(
    private readonly applications: ApplicationRegistry,
    private readonly storage: StorageStartup,
  ) {}

  /** The store is made ready first: nothing below may read or write before. */
  async onModuleInit(): Promise<void> {
    await this.storage.prepare();
    if (process.env.NODE_ENV !== 'production') {
      await this.applications.seedFirstPartyApplications();
    }
    await this.applications.ensureClientOriginAllowed();
  }
}

export async function reconcileStartupApplications(
  app: INestApplication,
): Promise<void> {
  await app.get(AudienceMappingAudit).assertMapped();
  await app.get(BrowserPolicyReconciler).reconcile();
  await app.get(ApplicationRegistry).reconcileNativeApplications();
}
