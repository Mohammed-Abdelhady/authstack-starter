import { parseOptionalInteger } from '../common/utils/environment-transform';
import type {
  HostAuthConfiguration,
  HostContractsConfiguration,
} from './types/host-contracts-config.type';
import {
  parseBrowserSession,
  parseBrowserSignIn,
} from './utils/host-policy-config.util';
import {
  ACTIVITY_RETENTION_DAYS_DEFAULT,
  EMAIL_CODE_EXPIRES_IN_DEFAULT, // feature:email-code
  INVITATION_EXPIRES_IN_DEFAULT, // feature:invitations
} from './constants/host-contracts';

/** Absence stays absence; application readers apply the existing session constants. */
export function createHostAuthConfig(): HostAuthConfiguration {
  return {
    web: {
      enabled: process.env.AUTH_WEB_ENABLED !== 'false',
      enabledExplicit: process.env.AUTH_WEB_ENABLED !== undefined,
      signIn: parseBrowserSignIn(
        process.env.AUTH_WEB_SIGN_IN,
        'AUTH_WEB_SIGN_IN',
      ),
      session: parseBrowserSession(
        process.env.AUTH_WEB_SESSION,
        'AUTH_WEB_SESSION',
      ),
    },
    admin: {
      signIn: parseBrowserSignIn(
        process.env.AUTH_ADMIN_SIGN_IN,
        'AUTH_ADMIN_SIGN_IN',
      ),
      session: parseBrowserSession(
        process.env.AUTH_ADMIN_SESSION,
        'AUTH_ADMIN_SESSION',
      ),
    },
    nativeLinkHost: process.env.AUTH_NATIVE_LINK_HOST,
  };
}

export function createHostContractsConfig(): HostContractsConfiguration {
  return {
    // feature:email-code:start
    emailCode: {
      enabled: process.env.EMAIL_CODE_ENABLED === 'true',
      expiresIn: Number(
        process.env.EMAIL_CODE_EXPIRES_IN ?? EMAIL_CODE_EXPIRES_IN_DEFAULT,
      ),
      review: {
        accountId: process.env.EMAIL_CODE_REVIEW_ACCOUNT_ID,
        clientId: process.env.EMAIL_CODE_REVIEW_CLIENT_ID,
        codeHash: process.env.EMAIL_CODE_REVIEW_CODE_HASH,
        until: process.env.EMAIL_CODE_REVIEW_UNTIL,
      },
    },
    // feature:email-code:end
    activity: {
      retentionDays: Number(
        process.env.ACTIVITY_RETENTION_DAYS ?? ACTIVITY_RETENTION_DAYS_DEFAULT,
      ),
    },
    // feature:invitations:start
    invitations: {
      expiresIn: Number(
        process.env.INVITATION_EXPIRES_IN ?? INVITATION_EXPIRES_IN_DEFAULT,
      ),
    },
    // feature:invitations:end
    admin: { strictMutations: process.env.ADMIN_STRICT_MUTATIONS === 'true' },
    account: {
      eraseGraceDays: parseOptionalInteger(
        process.env.ACCOUNT_ERASE_GRACE_DAYS,
      ),
    },
    providerTokens: {
      encryptionKey: process.env.PROVIDER_TOKEN_ENCRYPTION_KEY,
      previousEncryptionKey: process.env.PROVIDER_TOKEN_ENCRYPTION_KEY_PREVIOUS,
    },
  };
}
