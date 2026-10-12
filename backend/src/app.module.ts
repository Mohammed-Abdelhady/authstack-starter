// First, before any module file: it loads the environment those files read. // feature:database-choice
import { APP_CONFIGURATION } from './config/app-configuration';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrivateCacheInterceptor } from './common/interceptors/private-cache.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { HealthModule } from './health/health.module';
import { UserModule } from './user/user.module';
import { SessionModule } from './session/session.module';
import { NativeOAuthModule } from './session/native/oauth/native-oauth.module';
import { NativeAuthModule } from './auth/native/native-auth.module';
import { NativeFactorsModule } from './auth/native/factors/native-factors.module';
import { NativeProviderModule } from './auth/native/providers/native-provider.module'; // feature:oauth-core
import { AuthModule } from './auth/auth.module';
import { AuthMethodsController } from './auth/auth-methods.controller';
import { MagicLinkModule } from './auth/magic-link/magic-link.module'; // feature:magic-link
import { TwoFactorModule } from './auth/two-factor/two-factor.module'; // feature:totp
import { PasskeysModule } from './auth/passkeys/passkeys.module'; // feature:passkeys
import { OAuthModule } from './auth/oauth/oauth.module'; // feature:oauth-core
import { GoogleOAuthStrategy } from './auth/oauth/strategies/google-oauth.strategy'; // feature:google
import { GitHubOAuthStrategy } from './auth/oauth/strategies/github-oauth.strategy'; // feature:github
import { FacebookOAuthStrategy } from './auth/oauth/strategies/facebook-oauth.strategy'; // feature:facebook
import { MicrosoftOAuthStrategy } from './auth/oauth/strategies/microsoft-oauth.strategy'; // feature:microsoft
import { AppleOAuthStrategy } from './auth/oauth/strategies/apple-oauth.strategy'; // feature:apple
import { DiscordOAuthStrategy } from './auth/oauth/strategies/discord-oauth.strategy'; // feature:discord
import { LinkedInOAuthStrategy } from './auth/oauth/strategies/linkedin-oauth.strategy'; // feature:linkedin
import { GitLabOAuthStrategy } from './auth/oauth/strategies/gitlab-oauth.strategy'; // feature:gitlab
import { XOAuthStrategy } from './auth/oauth/strategies/x-oauth.strategy'; // feature:x
import { SlackOAuthStrategy } from './auth/oauth/strategies/slack-oauth.strategy'; // feature:slack
import { TwitchOAuthStrategy } from './auth/oauth/strategies/twitch-oauth.strategy'; // feature:twitch
import { OidcOAuthStrategy } from './auth/oauth/strategies/oidc-oauth.strategy'; // feature:oidc
import { AdminModule } from './admin/admin.module';
import { CommonModule } from './common/common.module';
import { MailModule } from './mail/mail.module';
import { DatabaseModule } from './database/database.module';
import { RoleModule } from './role/role.module';
import { STORAGE_CONNECTION_IMPORTS } from './common/persistence/common-persistence';

@Module({
  imports: [
    APP_CONFIGURATION,
    ...STORAGE_CONNECTION_IMPORTS,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('THROTTLE_TTL', 60) * 1000,
          limit: configService.get<number>('THROTTLE_LIMIT', 60),
        },
      ],
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    CommonModule,
    MailModule,
    DatabaseModule,
    UserModule,
    SessionModule,
    NativeOAuthModule,
    NativeAuthModule,
    NativeFactorsModule,
    NativeProviderModule, // feature:oauth-core
    RoleModule,
    AuthModule,
    // feature:oauth-core:start
    OAuthModule.register([
      GoogleOAuthStrategy, // feature:google
      GitHubOAuthStrategy, // feature:github
      FacebookOAuthStrategy, // feature:facebook
      MicrosoftOAuthStrategy, // feature:microsoft
      AppleOAuthStrategy, // feature:apple
      DiscordOAuthStrategy, // feature:discord
      LinkedInOAuthStrategy, // feature:linkedin
      GitLabOAuthStrategy, // feature:gitlab
      XOAuthStrategy, // feature:x
      SlackOAuthStrategy, // feature:slack
      TwitchOAuthStrategy, // feature:twitch
      OidcOAuthStrategy, // feature:oidc
    ]),
    // feature:oauth-core:end
    MagicLinkModule, // feature:magic-link
    PasskeysModule, // feature:passkeys
    TwoFactorModule, // feature:totp
    AdminModule,
  ],
  // AuthMethodsController sits here because this is the only context holding
  // both the auth configuration and the OAuth registry.
  controllers: [AppController, AuthMethodsController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestLoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PrivateCacheInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Applied here rather than in main.ts so that tests booting AppModule get the
   * correlation id too.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
