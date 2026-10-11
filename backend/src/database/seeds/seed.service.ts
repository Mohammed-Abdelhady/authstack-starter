import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { getSeedUsers, printSeedCredentials } from './user.seed';
import { RoleSeedService } from './role.seed';
import { ApplicationRegistry } from '../../session/applications/application-registry';
import { describeDriverError } from '../../common/utils/describe-error.util';
import { assertResetAllowed, SeedStore } from './seed.store';

@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly store: SeedStore,
    private readonly configService: ConfigService,
    private readonly roleSeedService: RoleSeedService,
    private readonly applications: ApplicationRegistry,
  ) {}

  async seedAll(): Promise<{
    roles: string;
    users: number;
    total: number;
  }> {
    this.logger.log('Starting database seeding...');

    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv !== 'development' && nodeEnv !== 'test') {
      throw new Error(
        'Database seeding is only allowed when NODE_ENV is "development" or "test".',
      );
    }

    await this.roleSeedService.seed();
    await this.applications.seedFirstPartyApplications();

    const usersCount = await this.seedUsers();

    const summary = {
      roles: 'seeded',
      users: usersCount,
      total: usersCount,
    };

    this.logger.log(`Database seeding completed: ${JSON.stringify(summary)}`);
    return summary;
  }

  async seedUsers(): Promise<number> {
    this.logger.log('Seeding users...');
    let createdCount = 0;

    const seedUsers = getSeedUsers();
    printSeedCredentials(seedUsers);

    for (const userData of seedUsers) {
      try {
        const existingId = await this.store.findAccountId(userData.email);

        if (existingId) {
          this.logger.log(
            `Seed user already exists (role: ${userData.role}) userId=${existingId}`,
          );
          continue;
        }

        const hashedPassword = await bcrypt.hash(
          userData.password,
          this.configService.get<number>('bcrypt.rounds', 10),
        );

        const createdId = await this.store.createAccount({
          email: userData.email,
          name: userData.name,
          role: userData.role,
          permissions: userData.permissions || [],
          passwordHash: hashedPassword,
        });

        this.logger.log(
          `Created seed user (role: ${userData.role}) userId=${createdId}`,
        );
        createdCount++;
      } catch (error) {
        // The message quotes input; the error's name and code identify it.
        this.logger.error(
          `Failed to create a seed user (role: ${userData.role}): error ${describeDriverError(error)}`,
        );
      }
    }

    this.logger.log(`Seeding users completed: ${createdCount} users created`);
    return createdCount;
  }

  async resetDatabase(): Promise<void> {
    this.logger.warn('Resetting database...');

    assertResetAllowed();

    await this.store.clearApplicationData();

    this.logger.warn('All application data cleared');

    await this.seedAll();

    this.logger.warn('Database reset completed');
  }
}
