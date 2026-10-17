import type { Provider } from '@nestjs/common';
import { onDatabase } from '../../../../common/persistence/postgres/postgres-providers';
import { ProviderLinkTicketStore } from '../../stores/provider-link-ticket.store';
import { PostgresProviderLinkTicketStore } from './postgres-provider-link-ticket.store';

export const POSTGRES_PROVIDER_LINK_PROVIDERS: Provider[] = [
  onDatabase(
    ProviderLinkTicketStore,
    (database) => new PostgresProviderLinkTicketStore(database),
  ),
];
