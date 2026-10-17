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
    commit: unknown = null,
  ): Promise<HealthService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: getConnectionToken(), useValue: connection },
        MONGO_STORE_HEALTH,
        {
          provide: ConfigService,
          useValue: new ConfigService({ auth: { epoch }, server: { commit } }),
        },
      ],
    }).compile();

    return module.get<HealthService>(HealthService);
  };

  describe('checkDatabaseHealth', () => {
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
  it('does not publish invalid metadata from a replaced configuration', async () => {
    const service = await buildService(
      { readyState: ConnectionStates.connected },
      1,
      { secret: 'not-public' },
    );
    expect(service.getHealth().commit).toBeNull();
  });
});
