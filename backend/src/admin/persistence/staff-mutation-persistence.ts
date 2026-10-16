import type { DynamicModule, Provider } from '@nestjs/common';

/** What StaffMutationsModule runs on. The one place it names a database. */
export const STAFF_MUTATION_PERSISTENCE_IMPORTS: DynamicModule[] = [];

export const STAFF_MUTATION_PERSISTENCE_PROVIDERS: Provider[] = [];
