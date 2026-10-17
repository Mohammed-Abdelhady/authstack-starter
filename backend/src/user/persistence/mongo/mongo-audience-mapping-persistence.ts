import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Role,
  RoleSchema,
} from '../../../role/persistence/mongo/schemas/role.schema';
import { AudienceMappingStore } from '../../stores/audience-mapping.store';
import { User, UserSchema } from './schemas/user.schema';
import { MongoAudienceMappingStore } from './mongo-audience-mapping.store';

export const MONGO_AUDIENCE_MAPPING_MODELS: DynamicModule =
  MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: Role.name, schema: RoleSchema },
  ]);

export const MONGO_AUDIENCE_MAPPING_PROVIDERS: Provider[] = [
  { provide: AudienceMappingStore, useClass: MongoAudienceMappingStore },
];
