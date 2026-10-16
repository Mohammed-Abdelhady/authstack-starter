import type { DynamicModule, Provider } from '@nestjs/common';

/** What InvitationsModule runs on. The one place it names a database. */
export const INVITATION_PERSISTENCE_IMPORTS: DynamicModule[] = [];

export const INVITATION_PERSISTENCE_PROVIDERS: Provider[] = [];
