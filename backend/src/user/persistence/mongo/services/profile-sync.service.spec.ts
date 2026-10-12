import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ProfileSyncService } from '../../../services/profile-sync.service';
import { User } from '../schemas/user.schema';
import { ErrorCode } from '../../../../common/enums/error-code.enum';
import { EMAIL_PROVIDER } from '../../../../common/constants/oauth-providers';
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

  /** The read paths add .select() before awaiting. */
  const resolveSelectedUser = (user: MockUser | null): void => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue(user),
    });
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
    it('should copy name and avatar from the primary provider', async () => {
      const user = buildUser({ primaryProvider: 'google' });
      resolveUser(user);

      const result = await service.syncProfileFromProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result.name).toBe('New Name');
      expect(result.avatarUrl).toBe('https://cdn.example.com/new.png');
      expect(result.lastSyncedProvider).toBe('google');
      expect(result.profileSyncedAt).toBeInstanceOf(Date);
      expect(user.save).toHaveBeenCalled();
    });

    it('should sync when no primary provider is set yet', async () => {
      const user = buildUser();
      resolveUser(user);

      const result = await service.syncProfileFromProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result.name).toBe('New Name');
    });

    it('should skip a provider that is not primary', async () => {
      const user = buildUser({ primaryProvider: 'github' });
      resolveUser(user);

      const result = await service.syncProfileFromProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result.name).toBe('Old Name');
      expect(user.save).not.toHaveBeenCalled();
    });

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

    it('should not save when the provider data matches the account', async () => {
      const user = buildUser({
        primaryProvider: 'google',
        name: GOOGLE_PROFILE.name,
        avatarUrl: GOOGLE_PROFILE.avatarUrl,
      });
      resolveUser(user);

      await service.syncProfileFromProvider(USER_ID, 'google', GOOGLE_PROFILE);

      expect(user.save).not.toHaveBeenCalled();
    });

    it('should never overwrite the account email', async () => {
      const user = buildUser({ primaryProvider: 'google' });
      resolveUser(user);

      const result = await service.syncProfileFromProvider(
        USER_ID,
        'google',
        GOOGLE_PROFILE,
      );

      expect(result).not.toHaveProperty('email', GOOGLE_PROFILE.email);
    });

    it('should reject a missing user', async () => {
      resolveUser(null);

      await expect(
        service.syncProfileFromProvider(USER_ID, 'google', GOOGLE_PROFILE),
      ).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('initiateManualSync', () => {
    it('should ask the client to re-authenticate with the primary provider', async () => {
      resolveSelectedUser(buildUser({ primaryProvider: 'google' }));

      await expect(service.initiateManualSync(USER_ID)).resolves.toEqual({
        requiresOAuth: true,
        provider: 'google',
        message: 'Please sign in with google to sync your profile',
      });
    });

    it('should refuse when the account only has email sign-in', async () => {
      resolveSelectedUser(buildUser({ primaryProvider: EMAIL_PROVIDER }));

      await expect(service.initiateManualSync(USER_ID)).rejects.toMatchObject({
        code: ErrorCode.PROVIDER_NOT_LINKED,
        status: 400,
      });
    });

    it('should reject a missing user', async () => {
      resolveSelectedUser(null);

      await expect(service.initiateManualSync(USER_ID)).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('getSyncStatus', () => {
    it('should report a syncable account', async () => {
      const syncedAt = new Date();
      resolveSelectedUser(
        buildUser({
          primaryProvider: 'google',
          lastSyncedProvider: 'google',
          profileSyncedAt: syncedAt,
        }),
      );

      await expect(service.getSyncStatus(USER_ID)).resolves.toEqual({
        lastSyncedAt: syncedAt,
        lastSyncedProvider: 'google',
        primaryProvider: 'google',
        canSync: true,
      });
    });

    it('should report canSync false for email sign-in', async () => {
      resolveSelectedUser(buildUser({ primaryProvider: EMAIL_PROVIDER }));

      const status = await service.getSyncStatus(USER_ID);

      expect(status.canSync).toBe(false);
    });
  });

  describe('resolveConflicts', () => {
    it('should prefer the profile of the primary provider', async () => {
      resolveSelectedUser(buildUser({ primaryProvider: 'github' }));

      const resolved = await service.resolveConflicts(
        USER_ID,
        new Map([
          ['google', { name: 'From Google' }],
          ['github', { name: 'From GitHub' }],
        ]),
      );

      expect(resolved).toEqual({ name: 'From GitHub' });
    });

    it('should fall back to the first profile when the primary is absent', async () => {
      resolveSelectedUser(buildUser({ primaryProvider: 'github' }));

      const resolved = await service.resolveConflicts(
        USER_ID,
        new Map([['google', { name: 'From Google' }]]),
      );

      expect(resolved).toEqual({ name: 'From Google' });
    });

    it('should return an empty profile when nothing is on offer', async () => {
      resolveSelectedUser(buildUser({ primaryProvider: 'github' }));

      await expect(
        service.resolveConflicts(USER_ID, new Map()),
      ).resolves.toEqual({});
    });
  });
});
