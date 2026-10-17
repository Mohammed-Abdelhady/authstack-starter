import type { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StaffIdempotencyStore } from '../../stores/staff-idempotency.store';
import { MongoStaffIdempotencyStore } from './mongo-staff-idempotency.store';
import {
  StaffIdempotencyKey,
  StaffIdempotencyKeySchema,
} from './schemas/staff-idempotency-key.schema';

export const MONGO_STAFF_MUTATION_MODELS: DynamicModule =
  MongooseModule.forFeature([
    { name: StaffIdempotencyKey.name, schema: StaffIdempotencyKeySchema },
  ]);

export const MONGO_STAFF_MUTATION_PROVIDERS: Provider[] = [
  { provide: StaffIdempotencyStore, useClass: MongoStaffIdempotencyStore },
];
