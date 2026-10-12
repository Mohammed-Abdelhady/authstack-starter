import { ConfigService } from '@nestjs/config';
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

const config = new ConfigService({});

/**
 * Whether a first sign-in through each provider may attach to an account that
 * already has the address. Written out per provider: only one that states,
 * for each address, that it verified it.
 */
describe('which providers attach a first sign-in to an existing account', () => {
  it('is every provider that sends a verification statement, and not Facebook', () => {
    expect({
      google: new GoogleOAuthStrategy(config).autoLinksByEmail, // feature:google
      github: new GitHubOAuthStrategy(config).autoLinksByEmail, // feature:github
      facebook: new FacebookOAuthStrategy(config).autoLinksByEmail, // feature:facebook
      microsoft: new MicrosoftOAuthStrategy(config).autoLinksByEmail, // feature:microsoft
      apple: new AppleOAuthStrategy(config).autoLinksByEmail, // feature:apple
      discord: new DiscordOAuthStrategy(config).autoLinksByEmail, // feature:discord
      linkedin: new LinkedInOAuthStrategy(config).autoLinksByEmail, // feature:linkedin
      gitlab: new GitLabOAuthStrategy(config).autoLinksByEmail, // feature:gitlab
      x: new XOAuthStrategy(config).autoLinksByEmail, // feature:x
      slack: new SlackOAuthStrategy(config).autoLinksByEmail, // feature:slack
      twitch: new TwitchOAuthStrategy(config).autoLinksByEmail, // feature:twitch
      oidc: new OidcOAuthStrategy(config).autoLinksByEmail, // feature:oidc
    }).toEqual({
      google: true, // feature:google
      github: true, // feature:github
      facebook: false, // feature:facebook
      microsoft: true, // feature:microsoft
      apple: true, // feature:apple
      discord: true, // feature:discord
      linkedin: true, // feature:linkedin
      gitlab: true, // feature:gitlab
      x: true, // feature:x
      slack: true, // feature:slack
      twitch: true, // feature:twitch
      oidc: true, // feature:oidc
    });
  });
});
