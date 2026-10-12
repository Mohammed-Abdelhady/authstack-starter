import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { HealthService } from '../../health.service';
import { MONGO_STORE_HEALTH } from './mongo-store-health';

describe('HealthService (X-11)', () => {
  const buildService = async (
    connection: Partial<Connection>,
    epoch = 1,
  ): Promise<HealthService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: getConnectionToken(), useValue: connection },
        MONGO_STORE_HEALTH,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback: number) =>
              key === 'auth.epoch' ? epoch : fallback,
          },
        },
      ],
    }).compile();

    return module.get<HealthService>(HealthService);
  };

  describe('checkDatabaseHealth', () => {
    it('should report connected when readyState is 1', async () => {
      const service = await buildService({
        readyState: ConnectionStates.connected,
      });

      expect(service.checkDatabaseHealth()).toEqual({ status: 'connected' });
    });

    it('should report disconnected for any other readyState', async () => {
      const service = await buildService({
        readyState: ConnectionStates.disconnected,
      });

      expect(service.checkDatabaseHealth()).toEqual({ status: 'disconnected' });
    });

    it('should report error when reading the connection throws', async () => {
      const connection = {} as Partial<Connection>;
      Object.defineProperty(connection, 'readyState', {
        get: () => {
          throw new Error('connection gone');
        },
      });

      const service = await buildService(connection);

      expect(service.checkDatabaseHealth()).toEqual({ status: 'error' });
    });
  });

  describe('getHealth', () => {
    it('should be healthy while the database is connected', async () => {
      const service = await buildService({
        readyState: ConnectionStates.connected,
      });

      const health = service.getHealth();

      expect(health.status).toBe('healthy');
      expect(Date.parse(health.timestamp)).not.toBeNaN();
    });

    it('should be unhealthy while the database is down', async () => {
      const service = await buildService({
        readyState: ConnectionStates.disconnected,
      });

      expect(service.getHealth().status).toBe('unhealthy');
    });

    it('should report readiness epoch and schema without uptime or environment (S-22)', async () => {
      const service = await buildService({
        readyState: ConnectionStates.connected,
      });

      const health = service.getHealth();
      expect(health.authEpoch).toBe(1);
      expect(health.authSchemaVersion).toBe(1);
      expect(Object.keys(health).sort()).toEqual([
        'authEpoch',
        'authSchemaVersion',
        'status',
        'timestamp',
      ]);
    });
  });
});
