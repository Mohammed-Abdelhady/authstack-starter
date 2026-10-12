import { DynamicModule, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  STORAGE_STARTUP_ATTEMPTS,
  STORAGE_STARTUP_CONNECTION_TIMEOUT_MS,
  STORAGE_STARTUP_RETRY_DELAY_MS,
} from '../storage-startup-retry';

export const MONGOOSE_CONNECTION_OPTIONS = {
  w: 'majority' as const,
  retryWrites: true,
  readPreference: 'primary' as const,
  serverSelectionTimeoutMS: STORAGE_STARTUP_CONNECTION_TIMEOUT_MS,
};

export function buildMongooseOptions(configService: ConfigService): {
  uri: string | undefined;
  w: 'majority';
  retryWrites: boolean;
  readPreference: 'primary';
  retryAttempts: number;
  retryDelay: number;
  serverSelectionTimeoutMS: number;
  connectionFactory: (connection: Connection) => Connection;
} {
  return {
    uri: configService.get<string>('MONGO_URI'),
    ...MONGOOSE_CONNECTION_OPTIONS,
    retryAttempts: STORAGE_STARTUP_ATTEMPTS,
    retryDelay: STORAGE_STARTUP_RETRY_DELAY_MS,
    connectionFactory: (connection: Connection) => {
      const logger = new Logger('Mongoose');
      connection.on('connected', () => {
        logger.log('Connected to MongoDB');
      });
      connection.on('error', (err: Error) => {
        logger.error(`MongoDB connection error: ${err.message}`, err.stack);
      });
      connection.on('disconnected', () => {
        logger.warn('Disconnected from MongoDB');
      });
      return connection;
    },
  };
}

/** The one connection every MongoDB adapter of the application shares. */
export const MONGO_CONNECTION: DynamicModule = MongooseModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: buildMongooseOptions,
  inject: [ConfigService],
});
