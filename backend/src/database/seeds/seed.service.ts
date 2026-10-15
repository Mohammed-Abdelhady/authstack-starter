import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import {
  ACCOUNT_RESERVATION_RESULT,
  AddressLedger,
} from '../../common/persistence/address-ledger';
import { AddressReservationTakenError } from '../../common/persistence/address-reservation-taken.error';
import { UnitOfWorkRunner } from '../../common/persistence/unit-of-work';
import { Clock } from '../../common/services/clock';
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
    private readonly runner: UnitOfWorkRunner,
    private readonly ledger: AddressLedger,
    private readonly clock: Clock,
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

        const createdId = await this.runner.run(async (unitOfWork) => {
          const reservation = await this.ledger.reserveForAccount(unitOfWork, {
            address: userData.email,
            now: this.clock.now(),
          });
          if (reservation.status === ACCOUNT_RESERVATION_RESULT.TAKEN)
            throw new AddressReservationTakenError();
          const audience = await this.store.roleAudience(
            unitOfWork,
            userData.role,
          );
          const id = await this.store.createAccount(unitOfWork, {
            audience,
            email: userData.email,
            name: userData.name,
            role: userData.role,
            permissions: userData.permissions || [],
            passwordHash: hashedPassword,
          });
          await this.ledger.finishAccountReservation(
            unitOfWork,
            reservation.reservation,
          );
          return id;
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
