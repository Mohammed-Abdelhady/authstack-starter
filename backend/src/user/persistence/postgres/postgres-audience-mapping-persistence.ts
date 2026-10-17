import { Provider } from '@nestjs/common';
import { AudienceMappingStore } from '../../stores/audience-mapping.store';
import { PostgresAudienceMappingStore } from './postgres-audience-mapping.store';

export const POSTGRES_AUDIENCE_MAPPING_PROVIDERS: Provider[] = [
  { provide: AudienceMappingStore, useClass: PostgresAudienceMappingStore },
];
