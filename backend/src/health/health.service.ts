import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTH_SCHEMA_VERSION,
  DEFAULT_AUTH_EPOCH,
} from '../session/constants/session-policy';
import { STORE_HEALTH, StoreHealth } from './store-health';

export type HealthStatus = 'healthy' | 'unhealthy';

export interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  authEpoch: number;
  authSchemaVersion: number;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly store: StoreHealth,
    private readonly configService: ConfigService,
  ) {}

  checkDatabaseHealth(): { status: 'connected' | 'disconnected' | 'error' } {
    try {
      if (this.store.current() === STORE_HEALTH.READY) {
        return { status: 'connected' };
      }
      return { status: 'disconnected' };
    } catch {
      return { status: 'error' };
    }
  }

  getHealth(): HealthResponse {
    const databaseHealth = this.checkDatabaseHealth();
    const isHealthy = databaseHealth.status === 'connected';

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      authEpoch: this.configService.get<number>(
        'auth.epoch',
        DEFAULT_AUTH_EPOCH,
      ),
      authSchemaVersion: AUTH_SCHEMA_VERSION,
    };
  }
}
