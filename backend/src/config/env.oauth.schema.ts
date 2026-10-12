import 'reflect-metadata';
import {
  IsNotEmpty, // feature:oauth-core,passkeys
  IsOptional,
  IsString,
  IsUrl,
  MinLength, // feature:oauth-core,passkeys
} from 'class-validator';
import { StorageEnvironmentVariables } from './env.storage.schema';

const OAUTH_STATE_SECRET_MIN_LENGTH = 32; // feature:oauth-core,passkeys

/**
 * OAuth part of the environment contract. Every provider variable is optional:
 * a provider turns itself on once its own variables are present, so a
 * deployment can ship with none of them set.
 */
export interface OAuthEnvironmentConfig {
  OAUTH_STATE_SECRET: string; // feature:oauth-core,passkeys
  OAUTH_CALLBACK_BASE_URL?: string;

  OAUTH_GOOGLE_CLIENT_ID?: string;
  OAUTH_GOOGLE_CLIENT_SECRET?: string;
  OAUTH_GOOGLE_CALLBACK_URL?: string;

  OAUTH_FACEBOOK_CLIENT_ID?: string;
  OAUTH_FACEBOOK_CLIENT_SECRET?: string;
  OAUTH_FACEBOOK_CALLBACK_URL?: string;

  OAUTH_GITHUB_CLIENT_ID?: string;
  OAUTH_GITHUB_CLIENT_SECRET?: string;
  OAUTH_GITHUB_CALLBACK_URL?: string;

  OAUTH_MICROSOFT_CLIENT_ID?: string;
  OAUTH_MICROSOFT_CLIENT_SECRET?: string;
  OAUTH_MICROSOFT_CALLBACK_URL?: string;
  /** Entra ID tenant segment of the authorize and token URLs. Defaults to `common`. */
  OAUTH_MICROSOFT_TENANT?: string;

  /** Apple Services ID. Apple has no static client secret; it is signed per request. */
  OAUTH_APPLE_CLIENT_ID?: string;
  OAUTH_APPLE_CALLBACK_URL?: string;
  OAUTH_APPLE_TEAM_ID?: string;
  OAUTH_APPLE_KEY_ID?: string;
  /** Contents of the .p8 sign-in key, with newlines written as \n. */
  OAUTH_APPLE_PRIVATE_KEY?: string;

  OAUTH_DISCORD_CLIENT_ID?: string;
  OAUTH_DISCORD_CLIENT_SECRET?: string;
  OAUTH_DISCORD_CALLBACK_URL?: string;

  OAUTH_LINKEDIN_CLIENT_ID?: string;
  OAUTH_LINKEDIN_CLIENT_SECRET?: string;
  OAUTH_LINKEDIN_CALLBACK_URL?: string;

  OAUTH_GITLAB_CLIENT_ID?: string;
  OAUTH_GITLAB_CLIENT_SECRET?: string;
  OAUTH_GITLAB_CALLBACK_URL?: string;
  /** Root of the GitLab instance. Defaults to https://gitlab.com. */
  OAUTH_GITLAB_BASE_URL?: string;

  OAUTH_X_CLIENT_ID?: string;
  OAUTH_X_CLIENT_SECRET?: string;
  OAUTH_X_CALLBACK_URL?: string;

  OAUTH_SLACK_CLIENT_ID?: string;
  OAUTH_SLACK_CLIENT_SECRET?: string;
  OAUTH_SLACK_CALLBACK_URL?: string;

  OAUTH_TWITCH_CLIENT_ID?: string;
  OAUTH_TWITCH_CLIENT_SECRET?: string;
  OAUTH_TWITCH_CALLBACK_URL?: string;

  OAUTH_OIDC_CLIENT_ID?: string;
  OAUTH_OIDC_CLIENT_SECRET?: string;
  OAUTH_OIDC_CALLBACK_URL?: string;
  /** Issuer the discovery document is read from and id_tokens are checked against. */
  OAUTH_OIDC_ISSUER?: string;
  /** Route segment and stored provider name. Defaults to `oidc`. */
  OAUTH_OIDC_PROVIDER_ID?: string;
  /** Name shown in the sign-in list. Defaults to `Single sign-on`. */
  OAUTH_OIDC_DISPLAY_NAME?: string;
  /** Space separated scopes. Defaults to `openid profile email`. */
  OAUTH_OIDC_SCOPES?: string;
  /** Endpoint overrides, for an issuer that publishes no discovery document. */
  OAUTH_OIDC_AUTHORIZATION_URL?: string;
  OAUTH_OIDC_TOKEN_URL?: string;
  OAUTH_OIDC_USERINFO_URL?: string;
  OAUTH_OIDC_JWKS_URL?: string;
}

/** Base class of EnvironmentVariables. class-validator reads inherited decorators. */
export class OAuthEnvironmentVariables extends StorageEnvironmentVariables {
  // feature:oauth-core,passkeys:start
  @IsString()
  @IsNotEmpty()
  @MinLength(OAUTH_STATE_SECRET_MIN_LENGTH, {
    message: `OAUTH_STATE_SECRET must be at least ${OAUTH_STATE_SECRET_MIN_LENGTH} characters`,
  })
  OAUTH_STATE_SECRET!: string;
  // feature:oauth-core,passkeys:end

  @IsString()
  @IsUrl({ require_protocol: true, require_tld: false })
  @IsOptional()
  OAUTH_CALLBACK_BASE_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_GOOGLE_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_GOOGLE_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_GOOGLE_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_FACEBOOK_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_FACEBOOK_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_FACEBOOK_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITHUB_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITHUB_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITHUB_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_MICROSOFT_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_MICROSOFT_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_MICROSOFT_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_MICROSOFT_TENANT?: string;

  @IsString()
  @IsOptional()
  OAUTH_APPLE_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_APPLE_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_APPLE_TEAM_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_APPLE_KEY_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_APPLE_PRIVATE_KEY?: string;

  @IsString()
  @IsOptional()
  OAUTH_DISCORD_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_DISCORD_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_DISCORD_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_LINKEDIN_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_LINKEDIN_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_LINKEDIN_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITLAB_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITLAB_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITLAB_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_GITLAB_BASE_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_X_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_X_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_X_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_SLACK_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_SLACK_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_SLACK_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_TWITCH_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_TWITCH_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_TWITCH_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_CALLBACK_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_ISSUER?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_PROVIDER_ID?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_DISPLAY_NAME?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_SCOPES?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_AUTHORIZATION_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_TOKEN_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_USERINFO_URL?: string;

  @IsString()
  @IsOptional()
  OAUTH_OIDC_JWKS_URL?: string;
}
