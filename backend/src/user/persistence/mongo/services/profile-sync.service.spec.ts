import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProfileSyncService } from '../../../services/profile-sync.service';
import { User } from '../schemas/user.schema';
import { OAuthProfile } from '../../../../auth/oauth/oauth-provider.interface';
import { MONGO_LINKED_ACCOUNT_STORE } from '../mongo-linked-account-stores';

const USER_ID = new Types.ObjectId().toString();

const GOOGLE_PROFILE: OAuthProfile = {
  providerId: 'google-123',
  email: 'user@example.com',
  emailVerified: true,
  name: 'New Name',
  avatarUrl: 'https://cdn.example.com/new.png',
};

interface MockUser {
  name: string;
  avatarUrl?: string;
  primaryProvider?: string;
  profileSyncedAt?: Date;
  lastSyncedProvider?: string;
  save: jest.Mock;
}

describe('ProfileSyncService', () => {
  let service: ProfileSyncService;

  const mockUserModel = { findById: jest.fn() };
  const mockConfigService = { get: jest.fn() };

  const buildUser = (overrides: Partial<MockUser> = {}): MockUser => ({
    name: 'Old Name',
    avatarUrl: 'https://cdn.example.com/old.png',
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  });

  /** syncProfileFromProvider awaits findById directly. */
  const resolveUser = (user: MockUser | null): void => {
    mockUserModel.findById.mockResolvedValue(user);
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileSyncService,
        MONGO_LINKED_ACCOUNT_STORE,
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ProfileSyncService>(ProfileSyncService);

    jest.clearAllMocks();
    mockConfigService.get.mockImplementation(
      (_key: string, fallback?: string) => fallback,
    );
  });

  describe('syncProfileFromProvider', () => {
    it('should honour the configured sync fields', async () => {
      mockConfigService.get.mockImplementation((key: string) =>
        key === 'profileSync.fields' ? 'picture' : undefined,
      );
      const user = buildUser({ primaryProvider: 'google' });
      resolveUser(user);

      const result = await service.syncProfileFromProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result.name).toBe('Old Name');
      expect(result.avatarUrl).toBe('https://cdn.example.com/new.png');
    });
  });
});
