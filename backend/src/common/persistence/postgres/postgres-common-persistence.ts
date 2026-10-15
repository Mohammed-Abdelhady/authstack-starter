import { Provider, Type } from '@nestjs/common';
import { AddressLedger } from '../address-ledger';
import { PostgresAddressLedger } from './postgres-address-ledger';
import { IdFormat } from '../id-format';
import { PostgresConnectionModule } from './postgres-connection';
import { PostgresIdFormat } from './postgres-id-format';

/** The one pool every PostgreSQL adapter of the application shares. */
export const POSTGRES_CONNECTION: Type = PostgresConnectionModule;

export const POSTGRES_COMMON_PROVIDERS: Provider[] = [
  { provide: AddressLedger, useClass: PostgresAddressLedger },
  { provide: IdFormat, useClass: PostgresIdFormat },
];
