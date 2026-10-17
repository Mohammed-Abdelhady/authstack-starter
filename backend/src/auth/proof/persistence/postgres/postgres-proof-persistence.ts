import { Provider } from '@nestjs/common';
import { SessionProofStore } from '../../stores/session-proof.store';
import { PostgresSessionProofStore } from './postgres-session-proof.store';

export const POSTGRES_PROOF_PROVIDERS: Provider[] = [
  { provide: SessionProofStore, useClass: PostgresSessionProofStore },
];
