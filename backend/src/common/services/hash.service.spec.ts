import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { HashService } from './hash.service';

jest.mock('bcrypt');

const mockedBcrypt = jest.mocked(bcrypt);
const CONFIGURED_ROUNDS = 4;

describe('HashService', () => {
  let service: HashService;

  const buildService = async (rounds?: number): Promise<HashService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HashService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (_key: string, fallback: number) => rounds ?? fallback,
            ),
          },
        },
      ],
    }).compile();

    return module.get<HashService>(HashService);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await buildService(CONFIGURED_ROUNDS);
  });

  describe('hash', () => {
    it('should hash with the configured cost', async () => {
      // The mock keeps the auto-mock instance; the implementation only has to
      // return what `await bcrypt.hash(...)` resolves to.
      mockedBcrypt.hash.mockImplementation(() => 'hashed');

      const result = await service.hash('plain-text');

      expect(mockedBcrypt.hash).toHaveBeenCalledWith(
        'plain-text',
        CONFIGURED_ROUNDS,
      );
      expect(result).toBe('hashed');
    });

    it('should fall back to 10 rounds when the config holds no value', async () => {
      mockedBcrypt.hash.mockImplementation(() => 'hashed');
      const fallbackService = await buildService();

      await fallbackService.hash('plain-text');

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('plain-text', 10);
    });
  });

  describe('compare', () => {
    it('should return true when bcrypt matches', async () => {
      mockedBcrypt.compare.mockImplementation(() => true);

      await expect(service.compare('plain', 'hash')).resolves.toBe(true);
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('plain', 'hash');
    });

    it('should return false when bcrypt does not match', async () => {
      mockedBcrypt.compare.mockImplementation(() => false);

      await expect(service.compare('plain', 'hash')).resolves.toBe(false);
    });
  });

  it('warms the dummy hash before the first request reaches the service', async () => {
    mockedBcrypt.hash.mockImplementation(() => 'dummy-hash');
    mockedBcrypt.compare.mockImplementation(() => false);
    const module = await Test.createTestingModule({
      providers: [
        HashService,
        {
          provide: ConfigService,
          useValue: new ConfigService({ bcrypt: { rounds: 4 } }),
        },
      ],
    }).compile();

    await module.init();
    expect(mockedBcrypt.hash).toHaveBeenCalledTimes(1);
    mockedBcrypt.hash.mockClear();
    mockedBcrypt.compare.mockClear();

    await module.get(HashService).spendComparison('first attempt');
    expect(mockedBcrypt.hash).not.toHaveBeenCalled();
    expect(mockedBcrypt.compare).toHaveBeenCalledWith(
      'first attempt',
      'dummy-hash',
    );
    await module.close();
  });
});
