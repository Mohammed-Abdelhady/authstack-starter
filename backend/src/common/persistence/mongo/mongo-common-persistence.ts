import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressLedger } from '../address-ledger';
import { MongoAddressLedger } from './mongo-address-ledger';
import {
  AddressClaim,
  AddressClaimSchema,
} from './schemas/address-claim.schema';
import {
  User,
  UserSchema,
} from '../../../user/persistence/mongo/schemas/user.schema';
import { IdFormat } from '../id-format';
import { MongoIdFormat } from './mongo-id-format';

export const MONGO_COMMON_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: AddressClaim.name, schema: AddressClaimSchema },
  { name: User.name, schema: UserSchema },
]);

export const MONGO_COMMON_PROVIDERS: Provider[] = [
  { provide: AddressLedger, useClass: MongoAddressLedger },
  { provide: IdFormat, useClass: MongoIdFormat },
];
