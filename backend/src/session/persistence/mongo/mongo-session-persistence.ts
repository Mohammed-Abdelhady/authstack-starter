import { DynamicModule, Provider, Type } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MONGO_STORAGE_STARTUP } from '../../../common/persistence/mongo/mongo-storage-startup';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { ApplicationAccessStore } from '../../applications/application-access.store';
import { ApplicationRegistryStore } from '../../applications/application-registry.store';
import { AuthorityApplications } from '../../authority/authority-applications';
import { SessionAuthorityStore } from '../../authority/session-authority.store';
import { SecurityEventStore } from '../../events/security-event.store';
import { BrowserIssuanceStore } from '../../issuance/browser-issuance.store';
import { IssuanceApplications } from '../../issuance/issuance-applications';
import { NativeAccessStore } from '../../native/credentials/native-access.store';
import { NativeCredentialStore } from '../../native/credentials/native-credential.store';
import { NativeSecurityEvents } from '../../native/credentials/native-security-events';
import { MongoNativeAccessStore } from '../../native/persistence/mongo/mongo-native-access.store';
import { MongoNativeCredentialStore } from '../../native/persistence/mongo/mongo-native-credential.store';
import { MongoNativeSecurityEvents } from '../../native/persistence/mongo/mongo-native-security-events';
import { BrowserProofStore } from '../../proofs/browser-proof.store';
import { SessionRevocationStore } from '../../revocation/session-revocation.store';
import { Application, ApplicationSchema } from './schemas/application.schema';
import {
  AuthorizationTransaction,
  AuthorizationTransactionSchema,
} from './schemas/authorization-transaction.schema';
import {
  BrowserProof,
  BrowserProofSchema,
} from './schemas/browser-proof.schema';
import {
  NativeCredential,
  NativeCredentialSchema,
} from './schemas/native-credential.schema';
import {
  NativeDpopProofId,
  NativeDpopProofIdSchema,
} from './schemas/native-dpop-proof-id.schema';
import {
  SecurityEvent,
  SecurityEventSchema,
} from './schemas/security-event.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import {
  StepUpChallenge,
  StepUpChallengeSchema,
} from './schemas/step-up-challenge.schema';
import {
  UserApplicationGrant,
  UserApplicationGrantSchema,
} from './schemas/user-application-grant.schema';
import { ApplicationAccessService } from './application-access.service';
import { ApplicationRegistryService } from './application-registry.service';
import { MongoApplicationAccessStore } from './mongo-application-access.store';
import { MongoApplicationRegistryStore } from './mongo-application-registry.store';
import { MongoAuthorityApplications } from './mongo-authority-applications';
import { MongoBrowserIssuanceStore } from './mongo-browser-issuance.store';
import { MongoBrowserProofStore } from './mongo-browser-proof.store';
import { MongoIssuanceApplications } from './mongo-issuance-applications';
import { MongoSecurityEventStore } from './mongo-security-event.store';
import { MongoSessionAuthorityStore } from './mongo-session-authority.store';
import { MongoSessionRevocationStore } from './mongo-session-revocation.store';
import { MongoUnitOfWorkRunner } from './mongo-unit-of-work';
import { SecurityEventService } from './security-event.service';
import { SessionAuthorityService } from './session-authority.service';
import { SessionRevocationService } from './session-revocation.service';

export const MONGO_SESSION_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: Session.name, schema: SessionSchema },
  { name: BrowserProof.name, schema: BrowserProofSchema },
  { name: NativeDpopProofId.name, schema: NativeDpopProofIdSchema },
  { name: Application.name, schema: ApplicationSchema },
  { name: UserApplicationGrant.name, schema: UserApplicationGrantSchema },
  { name: NativeCredential.name, schema: NativeCredentialSchema },
  {
    name: AuthorizationTransaction.name,
    schema: AuthorizationTransactionSchema,
  },
  { name: StepUpChallenge.name, schema: StepUpChallengeSchema },
  { name: SecurityEvent.name, schema: SecurityEventSchema },
  { name: User.name, schema: UserSchema },
]);

/**
 * The MongoDB faces of the session services: the same decisions, taken with
 * Mongoose ids and documents. The adapters call some of them, and specs that
 * speak Mongoose resolve the rest from the module.
 */
export const MONGO_SESSION_BRIDGES: Type[] = [
  ApplicationAccessService,
  ApplicationRegistryService,
  SecurityEventService,
  SessionAuthorityService,
  SessionRevocationService,
];

export const MONGO_SESSION_PROVIDERS: Provider[] = [
  {
    provide: ApplicationRegistryStore,
    useClass: MongoApplicationRegistryStore,
  },
  { provide: ApplicationAccessStore, useClass: MongoApplicationAccessStore },
  { provide: BrowserProofStore, useClass: MongoBrowserProofStore },
  { provide: SecurityEventStore, useClass: MongoSecurityEventStore },
  { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
  MONGO_STORAGE_STARTUP,
  { provide: BrowserIssuanceStore, useClass: MongoBrowserIssuanceStore },
  { provide: IssuanceApplications, useClass: MongoIssuanceApplications },
  { provide: SessionAuthorityStore, useClass: MongoSessionAuthorityStore },
  { provide: AuthorityApplications, useClass: MongoAuthorityApplications },
  { provide: SessionRevocationStore, useClass: MongoSessionRevocationStore },
  { provide: NativeCredentialStore, useClass: MongoNativeCredentialStore },
  { provide: NativeAccessStore, useClass: MongoNativeAccessStore },
  { provide: NativeSecurityEvents, useClass: MongoNativeSecurityEvents },
  ...MONGO_SESSION_BRIDGES,
];
