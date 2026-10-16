import type { DynamicModule, Provider } from '@nestjs/common';

/** What ProofModule runs on. The one place it names a database. */
export const PROOF_PERSISTENCE_IMPORTS: DynamicModule[] = [];

export const PROOF_PERSISTENCE_PROVIDERS: Provider[] = [];
