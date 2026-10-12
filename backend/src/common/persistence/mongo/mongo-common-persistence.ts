import { Provider } from '@nestjs/common';
import { IdFormat } from '../id-format';
import { MongoIdFormat } from './mongo-id-format';

export const MONGO_COMMON_PROVIDERS: Provider[] = [
  { provide: IdFormat, useClass: MongoIdFormat },
];
