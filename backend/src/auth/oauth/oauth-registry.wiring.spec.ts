import { ConfigService } from '@nestjs/config';
import { OAuthRegistryService } from './oauth-registry.service';
import { OAuthProviderStrategy } from './oauth-provider.interface';
import { GoogleOAuthStrategy } from './strategies/google-oauth.strategy'; // feature:google
import { GitHubOAuthStrategy } from './strategies/github-oauth.strategy'; // feature:github
import { FacebookOAuthStrategy } from './strategies/facebook-oauth.strategy'; // feature:facebook
import { MicrosoftOAuthStrategy } from './strategies/microsoft-oauth.strategy'; // feature:microsoft
import { AppleOAuthStrategy } from './strategies/apple-oauth.strategy'; // feature:apple
import { DiscordOAuthStrategy } from './strategies/discord-oauth.strategy'; // feature:discord
import { LinkedInOAuthStrategy } from './strategies/linkedin-oauth.strategy'; // feature:linkedin
import { GitLabOAuthStrategy } from './strategies/gitlab-oauth.strategy'; // feature:gitlab
import { XOAuthStrategy } from './strategies/x-oauth.strategy'; // feature:x
import { SlackOAuthStrategy } from './strategies/slack-oauth.strategy'; // feature:slack
import { TwitchOAuthStrategy } from './strategies/twitch-oauth.strategy'; // feature:twitch
import { OidcOAuthStrategy } from './strategies/oidc-oauth.strategy'; // feature:oidc
import { createOAuthConfig } from '../../config/oauth.config';

/**
 * Every registered provider, built from environment variables the way the
 * running application builds them. This covers the part of the boot check that
 * does not need a database: the config reader, each strategy and the registry
 * agreeing on the same provider ids.
 */

const CALLBACK_BASE_URL = 'https://api.example.com/api/auth/oauth'; // feature:oidc
const OIDC_ISSUER = 'https://sso.example.com'; // feature:oidc

// feature:oidc:start
/**
 * The generic provider reads its endpoints from the issuer's discovery
 * document at startup. Spelling all four out keeps this spec off the network.
 */
const OIDC_ENDPOINTS: Record<string, string> = {
  OAUTH_OIDC_ISSUER: OIDC_ISSUER,
  OAUTH_OIDC_AUTHORIZATION_URL: `${OIDC_ISSUER}/authorize`,
  OAUTH_OIDC_TOKEN_URL: `${OIDC_ISSUER}/token`,
  OAUTH_OIDC_USERINFO_URL: `${OIDC_ISSUER}/userinfo`,
  OAUTH_OIDC_JWKS_URL: `${OIDC_ISSUER}/jwks`,
};
// feature:oidc:end

const PROVIDER_ENV: Record<string, string> = {
  OAUTH_GOOGLE_CLIENT_ID: 'google-id', // feature:google
  OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret', // feature:google
  OAUTH_GITHUB_CLIENT_ID: 'github-id', // feature:github
  OAUTH_GITHUB_CLIENT_SECRET: 'github-secret', // feature:github
  OAUTH_FACEBOOK_CLIENT_ID: 'facebook-id', // feature:facebook
  OAUTH_FACEBOOK_CLIENT_SECRET: 'facebook-secret', // feature:facebook
  OAUTH_MICROSOFT_CLIENT_ID: 'microsoft-id', // feature:microsoft
  OAUTH_MICROSOFT_CLIENT_SECRET: 'microsoft-secret', // feature:microsoft
  OAUTH_MICROSOFT_TENANT: 'common', // feature:microsoft
  OAUTH_APPLE_CLIENT_ID: 'com.example.web', // feature:apple
  OAUTH_APPLE_TEAM_ID: 'ABCDE12345', // feature:apple
  OAUTH_APPLE_KEY_ID: 'KEY1234567', // feature:apple
  // feature:apple:start
  OAUTH_APPLE_PRIVATE_KEY:
    '-----BEGIN PRIVATE KEY-----\\nMIGT\\n-----END PRIVATE KEY-----',
  // feature:apple:end
  OAUTH_DISCORD_CLIENT_ID: 'discord-id', // feature:discord
  OAUTH_DISCORD_CLIENT_SECRET: 'discord-secret', // feature:discord
  OAUTH_LINKEDIN_CLIENT_ID: 'linkedin-id', // feature:linkedin
  OAUTH_LINKEDIN_CLIENT_SECRET: 'linkedin-secret', // feature:linkedin
  OAUTH_GITLAB_CLIENT_ID: 'gitlab-id', // feature:gitlab
  OAUTH_GITLAB_CLIENT_SECRET: 'gitlab-secret', // feature:gitlab
  OAUTH_X_CLIENT_ID: 'x-id', // feature:x
  OAUTH_X_CLIENT_SECRET: 'x-secret', // feature:x
  OAUTH_SLACK_CLIENT_ID: 'slack-id', // feature:slack
  OAUTH_SLACK_CLIENT_SECRET: 'slack-secret', // feature:slack
  OAUTH_TWITCH_CLIENT_ID: 'twitch-id', // feature:twitch
  OAUTH_TWITCH_CLIENT_SECRET: 'twitch-secret', // feature:twitch
  OAUTH_OIDC_CLIENT_ID: 'oidc-id', // feature:oidc
  OAUTH_OIDC_CLIENT_SECRET: 'oidc-secret', // feature:oidc
  ...OIDC_ENDPOINTS, // feature:oidc
};

function configServiceFromEnv(env: Record<string, string>): ConfigService {
  const previous = process.env;
  // Start from an env without OAuth variables, so a loaded .env cannot leak in.
  process.env = Object.fromEntries(
    Object.entries(previous).filter(([key]) => !key.startsWith('OAUTH_')),
  );
  Object.assign(process.env, env);
  const oauth = createOAuthConfig('https://api.example.com');
  process.env = previous;

  const values: Record<string, unknown> = {
    'oauth.callbackBaseUrl': oauth.callbackBaseUrl,
  };
  for (const [id, provider] of Object.entries(oauth.providers)) {
    values[`oauth.providers.${id}`] = provider;
  }

  return new ConfigService(values);
}

function registryFor(env: Record<string, string>): OAuthRegistryService {
  const configService = configServiceFromEnv(env);
  const strategies: OAuthProviderStrategy[] = [
    new GoogleOAuthStrategy(configService), // feature:google
    new GitHubOAuthStrategy(configService), // feature:github
    new FacebookOAuthStrategy(configService), // feature:facebook
    new MicrosoftOAuthStrategy(configService), // feature:microsoft
    new AppleOAuthStrategy(configService), // feature:apple
    new DiscordOAuthStrategy(configService), // feature:discord
    new LinkedInOAuthStrategy(configService), // feature:linkedin
    new GitLabOAuthStrategy(configService), // feature:gitlab
    new XOAuthStrategy(configService), // feature:x
    new SlackOAuthStrategy(configService), // feature:slack
    new TwitchOAuthStrategy(configService), // feature:twitch
    new OidcOAuthStrategy(configService), // feature:oidc
  ];

  return new OAuthRegistryService(strategies, configService);
}

describe('OAuth provider wiring', () => {
  it('enables each provider from its own variables', () => {
    expect(registryFor(PROVIDER_ENV).listEnabled()).toEqual([
      { id: 'google', displayName: 'Google' }, // feature:google
      { id: 'github', displayName: 'GitHub' }, // feature:github
      { id: 'facebook', displayName: 'Facebook' }, // feature:facebook
      { id: 'microsoft', displayName: 'Microsoft' }, // feature:microsoft
      { id: 'apple', displayName: 'Apple' }, // feature:apple
      { id: 'discord', displayName: 'Discord' }, // feature:discord
      { id: 'linkedin', displayName: 'LinkedIn' }, // feature:linkedin
      { id: 'gitlab', displayName: 'GitLab' }, // feature:gitlab
      { id: 'x', displayName: 'X' }, // feature:x
      { id: 'slack', displayName: 'Slack' }, // feature:slack
      { id: 'twitch', displayName: 'Twitch' }, // feature:twitch
      { id: 'oidc', displayName: 'Single sign-on' }, // feature:oidc
    ]);
  });

  // feature:oidc:start
  it('serves the generic provider under the id it was given', () => {
    const registry = registryFor({
      ...PROVIDER_ENV,
      OAUTH_OIDC_PROVIDER_ID: 'keycloak',
      OAUTH_OIDC_DISPLAY_NAME: 'Company account',
    });

    expect(registry.has('oidc')).toBe(false);
    expect(registry.isEnabled('keycloak')).toBe(true);
    expect(registry.getCallbackUrl('keycloak')).toBe(
      `${CALLBACK_BASE_URL}/keycloak/callback`,
    );
  });

  it('keeps the generic provider off until its endpoints resolve', () => {
    const withoutEndpoints = { ...PROVIDER_ENV };
    delete withoutEndpoints.OAUTH_OIDC_JWKS_URL;

    // Discovery only runs in onModuleInit, which no strategy here has had.
    expect(registryFor(withoutEndpoints).isEnabled('oidc')).toBe(false);
  });
  // feature:oidc:end

  it('leaves every provider off when nothing is configured', () => {
    expect(registryFor({}).listEnabled()).toEqual([]);
  });

  // feature:apple:start
  it('keeps Apple off until the whole sign-in key is present', () => {
    const withoutKey = { ...PROVIDER_ENV };
    delete withoutKey.OAUTH_APPLE_PRIVATE_KEY;

    expect(registryFor(withoutKey).isEnabled('apple')).toBe(false);
  });

  it('sends only Apple through a POST callback', () => {
    const registry = registryFor(PROVIDER_ENV);
    const posting = registry
      .getIds()
      .filter((id) => registry.get(id).callbackMethod === 'POST');

    expect(posting).toEqual(['apple']);
  });
  // feature:apple:end
});
