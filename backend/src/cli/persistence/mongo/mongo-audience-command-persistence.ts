import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UnitOfWorkRunner } from '../../../common/persistence/unit-of-work';
import {
  Role,
  RoleSchema,
} from '../../../role/persistence/mongo/schemas/role.schema';
import { MongoSessionRevocationStore } from '../../../session/persistence/mongo/mongo-session-revocation.store';
import { MongoUnitOfWorkRunner } from '../../../session/persistence/mongo/mongo-unit-of-work';
import {
  SecurityEvent,
  SecurityEventSchema,
} from '../../../session/persistence/mongo/schemas/security-event.schema';
import {
  Session,
  SessionSchema,
} from '../../../session/persistence/mongo/schemas/session.schema';
import { SecurityEventService } from '../../../session/persistence/mongo/security-event.service';
import { SessionRevocationStore } from '../../../session/revocation/session-revocation.store';
import { MongoAudienceMappingStore } from '../../../user/persistence/mongo/mongo-audience-mapping.store';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { AudienceMappingStore } from '../../../user/stores/audience-mapping.store';

export const MONGO_AUDIENCE_COMMAND_MODELS: DynamicModule =
  MongooseModule.forFeature([
    {
      name: User.name,
      schema: UserSchema.clone()
        .set('autoIndex', false)
        .set('autoCreate', false),
    },
    {
      name: Role.name,
      schema: RoleSchema.clone()
        .set('autoIndex', false)
        .set('autoCreate', false),
    },
    {
      name: Session.name,
      schema: SessionSchema.clone()
        .set('autoIndex', false)
        .set('autoCreate', false),
    },
    {
      name: SecurityEvent.name,
      schema: SecurityEventSchema.clone()
        .set('autoIndex', false)
        .set('autoCreate', false),
    },
  ]);

export const MONGO_AUDIENCE_COMMAND_PROVIDERS: Provider[] = [
  { provide: UnitOfWorkRunner, useClass: MongoUnitOfWorkRunner },
  { provide: SessionRevocationStore, useClass: MongoSessionRevocationStore },
  { provide: AudienceMappingStore, useClass: MongoAudienceMappingStore },
  SecurityEventService,
];
