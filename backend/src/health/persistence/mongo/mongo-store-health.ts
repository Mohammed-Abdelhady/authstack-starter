import { Injectable, Provider } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import {
  STORE_HEALTH,
  StoreHealth,
  StoreHealthState,
} from '../../store-health';

/**
 * The driver keeps the connection state itself, from its own heartbeats. A
 * connected driver is taken as ready: the connection is opened with a primary
 * read preference and majority writes, so it has no other member to serve from.
 */
@Injectable()
export class MongoStoreHealth extends StoreHealth {
  constructor(@InjectConnection() private readonly connection: Connection) {
    super();
  }

  current(): StoreHealthState {
    return this.connection.readyState === ConnectionStates.connected
      ? STORE_HEALTH.READY
      : STORE_HEALTH.UNREACHABLE;
  }
}

export const MONGO_STORE_HEALTH: Provider = {
  provide: StoreHealth,
  useClass: MongoStoreHealth,
};
