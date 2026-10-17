import { DynamicModule, Provider } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SessionProofStore } from '../../stores/session-proof.store';
import { MongoSessionProofStore } from './mongo-session-proof.store';
import { SessionProof, SessionProofSchema } from './session-proof.schema';

export const MONGO_PROOF_MODELS: DynamicModule = MongooseModule.forFeature([
  { name: SessionProof.name, schema: SessionProofSchema },
]);

export const MONGO_PROOF_PROVIDERS: Provider[] = [
  { provide: SessionProofStore, useClass: MongoSessionProofStore },
];
