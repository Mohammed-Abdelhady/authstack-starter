import { parseServerCommit } from './utils/server-commit.util';
import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';
import { EnvironmentVariables } from './env.schema';
import { validateHostApplications } from './utils/host-application-validation';
import { PASSKEY_CHALLENGE_TTL_MS } from '../auth/passkeys/constants/passkeys.constants'; // feature:passkeys

function formatValidationErrors(errors: ValidationError[]): string[] {
  const messages: string[] = [];

  for (const error of errors) {
    if (error.constraints) {
      const constraints = Object.values(error.constraints).join(', ');
      messages.push(`- ${error.property}: ${constraints}`);
    }
    if (error.children && error.children.length > 0) {
      messages.push(...formatValidationErrors(error.children));
    }
  }

  return messages;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentVariables {
  if (
    config.SERVER_COMMIT_SHA !== undefined &&
    parseServerCommit(config.SERVER_COMMIT_SHA) === null
  ) {
    throw new Error(
      'SERVER_COMMIT_SHA must be a complete 40-character hexadecimal Git commit.',
    );
  }
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const errorMessages = formatValidationErrors(errors);
    throw new Error(
      `Environment validation failed for variables:\n${errorMessages.join('\n')}`,
    );
  }

  // feature:passkeys:start
  if (
    validatedConfig.PASSKEY_CHALLENGE_SECRET_PREVIOUS &&
    !validatedConfig.PASSKEY_CHALLENGE_SECRET
  ) {
    throw new Error(
      'PASSKEY_CHALLENGE_SECRET_PREVIOUS requires PASSKEY_CHALLENGE_SECRET',
    );
  }
  if (
    validatedConfig.PASSKEY_CHALLENGE_SECRET_PREVIOUS &&
    validatedConfig.PASSKEY_CHALLENGE_SECRET_PREVIOUS ===
      validatedConfig.PASSKEY_CHALLENGE_SECRET
  ) {
    throw new Error(
      'PASSKEY_CHALLENGE_SECRET_PREVIOUS must differ from PASSKEY_CHALLENGE_SECRET',
    );
  }
  if (
    validatedConfig.PASSKEY_CHALLENGE_SECRET &&
    validatedConfig.PASSKEY_CHALLENGE_SECRET ===
      validatedConfig.OAUTH_STATE_SECRET
  ) {
    throw new Error(
      'PASSKEY_CHALLENGE_SECRET must differ from OAUTH_STATE_SECRET',
    );
  }
  if (
    validatedConfig.PASSKEY_CHALLENGE_SECRET_PREVIOUS &&
    validatedConfig.PASSKEY_CHALLENGE_SECRET_PREVIOUS ===
      validatedConfig.OAUTH_STATE_SECRET
  ) {
    throw new Error(
      'PASSKEY_CHALLENGE_SECRET_PREVIOUS must differ from OAUTH_STATE_SECRET',
    );
  }
  if (validatedConfig.PASSKEY_CHALLENGE_LEGACY_UNTIL) {
    const until = Date.parse(validatedConfig.PASSKEY_CHALLENGE_LEGACY_UNTIL);
    if (
      !validatedConfig.PASSKEY_CHALLENGE_SECRET ||
      until > Date.now() + PASSKEY_CHALLENGE_TTL_MS
    ) {
      throw new Error(
        'PASSKEY_CHALLENGE_LEGACY_UNTIL requires a dedicated secret and at most five minutes of fallback',
      );
    }
  }

  // feature:passkeys:end
  validateHostApplications(validatedConfig);
  if (config.AUTH_WEB_ENABLED === undefined) {
    // Nest copies enumerable validated defaults into process.env. Keep absence.
    Object.defineProperty(validatedConfig, 'AUTH_WEB_ENABLED', {
      enumerable: false,
    });
  }
  return validatedConfig;
}
