import { ConfigModule } from '@nestjs/config';
import { confirmStorageChoice } from '../common/persistence/storage-choice'; // feature:database-choice
import configuration from './configuration';
import { validateEnvironment } from './env.validation';

/**
 * Reads and validates the environment as soon as this file is loaded. The
 * application module imports it before any other module file, because each of
 * those picks its database adapter from the environment when it is loaded.
 */
export const APP_CONFIGURATION = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: '.env',
  load: [configuration],
  validationOptions: {
    allowUnknown: true,
    abortOnError: true,
  },
  validate: (environment: Record<string, unknown>) => {
    const validated = validateEnvironment(environment);
    confirmStorageChoice(validated.DATABASE_TYPE); // feature:database-choice
    return validated;
  },
});
