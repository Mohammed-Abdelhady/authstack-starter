import { Provider, Type } from '@nestjs/common';
import { IdFormat } from '../id-format';
import { PostgresConnectionModule } from './postgres-connection';
import { PostgresIdFormat } from './postgres-id-format';

/** The one pool every PostgreSQL adapter of the application shares. */
export const POSTGRES_CONNECTION: Type = PostgresConnectionModule;

export const POSTGRES_COMMON_PROVIDERS: Provider[] = [
  { provide: IdFormat, useClass: PostgresIdFormat },
];
