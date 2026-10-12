import { Module, OnModuleInit, type INestApplication } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { StorageStartup } from '../common/persistence/storage-startup';
import { UnitOfWorkRunner } from '../common/persistence/unit-of-work';
import { ApplicationAccess } from './applications/application-access';
import { ApplicationAccessStore } from './applications/application-access.store';
import { ApplicationRegistry } from './applications/application-registry';
import { ApplicationRegistryStore } from './applications/application-registry.store';
import { AuthorityApplications } from './authority/authority-applications';
import { AuthenticatedSessions } from './authority/authenticated-session';
import { SessionAuthorityStore } from './authority/session-authority.store';
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
  imports: [CommonModule, ...SESSION_PERSISTENCE_IMPORTS],
  providers: [
    ...SESSION_PERSISTENCE_PROVIDERS,
    ApplicationRegistry,
    ApplicationAccess,
    BrowserProofService,
    NativeSessionRevocationService,
    SecurityEventRecorder,
    SessionIssuanceService,
    SessionValidator,
    AuthenticatedSessions,
    SessionRevoker,
    NativeAccessValidator,
    NativeAccessService,
  ],
  exports: [
    ...SESSION_PERSISTENCE_EXPORTS,
    CommonModule,
    ApplicationRegistryStore,
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
  await app.get(ApplicationRegistry).reconcileNativeApplications();
}
