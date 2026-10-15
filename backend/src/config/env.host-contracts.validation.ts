import type { HostContractsEnvironmentVariables } from './env.host-contracts.schema';

// feature:email-code:start
import { REVIEW_MAX_AHEAD_MS } from './constants/host-contracts';
// feature:email-code:end

export function validateHostContractSettings(
  config: HostContractsEnvironmentVariables,
): void {
  // feature:email-code:start
  const reviewFields = [
    config.EMAIL_CODE_REVIEW_ACCOUNT_ID,
    config.EMAIL_CODE_REVIEW_CLIENT_ID,
    config.EMAIL_CODE_REVIEW_CODE_HASH,
    config.EMAIL_CODE_REVIEW_UNTIL,
  ];
  const present = reviewFields.filter((value) => value !== undefined).length;
  if (present !== 0 && present !== reviewFields.length) {
    throw new Error(
      'EMAIL_CODE_REVIEW requires all four review settings or none',
    );
  }
  if (config.EMAIL_CODE_REVIEW_UNTIL !== undefined) {
    const until = Date.parse(config.EMAIL_CODE_REVIEW_UNTIL);
    if (!Number.isFinite(until) || until > Date.now() + REVIEW_MAX_AHEAD_MS) {
      throw new Error(
        `EMAIL_CODE_REVIEW_UNTIL must be at most ${REVIEW_MAX_AHEAD_MS / (24 * 60 * 60 * 1000)} days ahead`,
      );
    }
  }
  // feature:email-code:end
  if (
    config.PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS &&
    !config.PROVIDER_TOKEN_ENCRYPTION_KEY
  ) {
    throw new Error(
      'PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS requires PROVIDER_TOKEN_ENCRYPTION_KEY',
    );
  }
  if (
    config.PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS &&
    config.PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS ===
      config.PROVIDER_TOKEN_ENCRYPTION_KEY
  ) {
    throw new Error(
      'PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS must differ from PROVIDER_TOKEN_ENCRYPTION_KEY',
    );
  }
}
