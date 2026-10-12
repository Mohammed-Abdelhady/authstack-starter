import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SeedService } from './seed.service';
import { RoleSeedService } from './role.seed';
import { SessionModule } from '../../session/session.module';
import {
  SEED_PERSISTENCE_IMPORTS,
  SEED_PERSISTENCE_PROVIDERS,
} from './persistence/seed-persistence';

/**
 * Seed Module
 *
 * This module provides database seeding functionality.
 * It imports the UserModule to access the UserModel and provides
 * the SeedService for seeding operations.
 */
@Module({
  imports: [ConfigModule, ...SEED_PERSISTENCE_IMPORTS, SessionModule],
  providers: [SeedService, RoleSeedService, ...SEED_PERSISTENCE_PROVIDERS],
  exports: [SeedService],
})
export class SeedModule {}
