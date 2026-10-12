import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from '../../common/constants/oauth-providers';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/enums/error-code.enum';
import { describeStoreFailure } from '../../common/persistence/store-failure';
import { OAuthProfile } from '../../auth/oauth/oauth-provider.interface';
import { LinkedAccountStore } from '../stores/linked-account.store';
import { StoredAccount } from '../stores/stored-account';

const SYNC_BATCH_SIZE = 100;

/**
 * Profile Sync Service
 * Handles automatic profile synchronization from OAuth providers
 */
@Injectable()
export class ProfileSyncService {
  private readonly logger = new Logger(ProfileSyncService.name);

  constructor(
    private readonly links: LinkedAccountStore,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Sync user profile from OAuth provider data
   * Called during OAuth login to keep profile up-to-date
   *
   * @param userId - User ID to sync
   * @param provider - OAuth provider
   * @param profile - OAuth user profile from provider
   * @returns The account as stored after the sync
   */
  async syncProfileFromProvider(
    userId: string,
    provider: string,
    profile: OAuthProfile,
  ): Promise<StoredAccount> {
    const user = await this.links.findSyncTarget(userId);

    if (!user) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    // Only sync if this is the primary provider or no primary is set
    const shouldSync =
      !user.primaryProvider || user.primaryProvider === provider;

    if (!shouldSync) {
      this.logger.debug(
        `Skipping profile sync for user ${userId} - ${provider} is not primary provider`,
      );
      return user;
    }

    // Get sync fields from configuration (default: name, picture)
    const rawFields =
      this.configService.get<string>('profileSync.fields') ||
      this.configService.get<string>('PROFILE_SYNC_FIELDS', 'name,picture');
    const syncFields = rawFields
      .split(',')
      .map((field: string): string => field.trim())
      .filter(Boolean);

    const changes: { name?: string; avatarUrl?: string } = {};

    // Sync name if configured
    if (
      syncFields.includes('name') &&
      profile.name &&
      profile.name !== user.name
    ) {
      changes.name = profile.name;
      this.logger.log(`Updated name for user ${userId} from ${provider}`);
    }

    // Email is never synced: the account email only changes through a verified flow

    if (
      syncFields.includes('picture') &&
      profile.avatarUrl &&
      profile.avatarUrl !== user.avatarUrl
    ) {
      changes.avatarUrl = profile.avatarUrl;
    }

    if (changes.name === undefined && changes.avatarUrl === undefined) {
      return user;
    }

    const synced = await this.links.saveSyncedProfile(user, {
      ...changes,
      profileSyncedAt: new Date(),
      lastSyncedProvider: provider,
    });
    this.logger.log(`Profile synced for user ${userId} from ${provider}`);
    return synced;
  }

  /**
   * Manual profile sync from primary provider
   * Requires user to re-authenticate with OAuth to get fresh data
   *
   * @param userId - User ID to sync
   * @returns Sync instructions for frontend
   */
  async initiateManualSync(userId: string): Promise<{
    requiresOAuth: boolean;
    provider: string;
    message: string;
  }> {
    const user = await this.links.findSyncSource(userId);

    if (!user) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    // Determine which provider to sync from
    const syncProvider = user.primaryProvider || EMAIL_PROVIDER;

    // If provider is EMAIL (email/password), no sync possible
    if (syncProvider === EMAIL_PROVIDER) {
      throw new AppException(
        ErrorCode.PROVIDER_NOT_LINKED,
        ErrorCode.PROVIDER_NOT_LINKED,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Return instructions to re-authenticate via OAuth
    return {
      requiresOAuth: true,
      provider: syncProvider,
      message: `Please sign in with ${syncProvider} to sync your profile`,
    };
  }

  /**
   * Get profile sync status for a user
   *
   * @param userId - User ID
   * @returns Sync status information
   */
  async getSyncStatus(userId: string): Promise<{
    lastSyncedAt?: Date;
    lastSyncedProvider?: string;
    primaryProvider?: string;
    canSync: boolean;
  }> {
    const user = await this.links.findSyncStatus(userId);

    if (!user) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    const canSync =
      user.primaryProvider && user.primaryProvider !== EMAIL_PROVIDER;

    return {
      lastSyncedAt: user.profileSyncedAt,
      lastSyncedProvider: user.lastSyncedProvider,
      primaryProvider: user.primaryProvider,
      canSync: Boolean(canSync),
    };
  }

  /**
   * Automatic profile sync cron job
   * Runs daily at 2 AM to sync profiles for users with OAuth primary providers
   *
   * NOTE: This requires storing OAuth refresh tokens for background sync
   * Currently disabled until OAuth token storage is implemented
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, {
    name: 'profile-sync',
    disabled: true, // Disabled until OAuth token storage implemented
  })
  async scheduleProfileSync(): Promise<void> {
    const isEnabled =
      this.configService.get<boolean>('profileSync.enabled') ??
      this.configService.get<boolean>('PROFILE_SYNC_ENABLED', true);

    if (!isEnabled) {
      this.logger.debug('Automatic profile sync is disabled');
      return;
    }

    this.logger.log('Starting automatic profile sync cron job');

    try {
      // Find users with OAuth primary providers who haven't synced in 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Process in batches
      const due = await this.links.countDueForSync(
        oneDayAgo,
        EMAIL_PROVIDER,
        SYNC_BATCH_SIZE,
      );

      this.logger.log(`Found ${due} users to sync`);

      // TODO: Implement background sync with stored OAuth refresh tokens
      // For each user:
      // 1. Get stored OAuth refresh token
      // 2. Refresh access token
      // 3. Fetch profile from provider
      // 4. Update user profile
      // 5. Update profileSyncedAt timestamp

      this.logger.log('Automatic profile sync completed');
    } catch (error) {
      this.logger.error(
        `Automatic profile sync failed: ${describeStoreFailure(error)}`,
      );
    }
  }

  /**
   * Handle profile conflicts when syncing from multiple providers
   * Uses primary provider as source of truth
   *
   * @param userId - User ID
   * @param profiles - Map of provider to profile data
   * @returns Resolved profile data
   */
  async resolveConflicts(
    userId: string,
    profiles: Map<string, Partial<OAuthProfile>>,
  ): Promise<Partial<OAuthProfile>> {
    const user = await this.links.findConflictSource(userId);

    if (!user) {
      throw new AppException(
        ErrorCode.USER_NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    }

    // Use primary provider as source of truth
    const primaryProvider = user.primaryProvider || EMAIL_PROVIDER;
    const primaryProfile = profiles.get(primaryProvider);

    if (primaryProfile) {
      this.logger.log(
        `Resolved conflicts for user ${userId} using primary provider ${primaryProvider}`,
      );
      return primaryProfile;
    }

    // Fallback: use first available profile
    const firstProfile = Array.from(profiles.values())[0];
    this.logger.warn(
      `Primary provider ${primaryProvider} profile not found for user ${userId}, using fallback`,
    );

    return firstProfile || {};
  }
}
