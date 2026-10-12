import { DynamicModule, Module, Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth.module';
import { UserModule } from '../../user/user.module';
import { OAUTH_STRATEGIES } from './oauth.constants';
import { OAuthProviderStrategy } from './oauth-provider.interface';
import { OAuthController } from './oauth.controller';
import { OAuthRegistryService } from './oauth-registry.service';
import { OAuthRedirectService } from './oauth-redirect.service';
import { OAuthStateService } from './oauth-state.service';
import { OAuthService } from './oauth.service';
import {
  OAUTH_PERSISTENCE_IMPORTS,
  OAUTH_PERSISTENCE_PROVIDERS,
} from './persistence/oauth-persistence';
import { IsRegisteredProviderConstraint } from './validators/is-registered-provider.validator';

/**
 * OAuth provider registry.
 *
 * `OAuthModule.register([...])` is the only place that names concrete
 * providers; everything downstream resolves them through OAuthRegistryService.
 */
@Module({})
export class OAuthModule {
  static register(
    strategies: Type<OAuthProviderStrategy>[] = [],
  ): DynamicModule {
    return {
      module: OAuthModule,
      imports: [
        ConfigModule,
        ...OAUTH_PERSISTENCE_IMPORTS,
        // Named directly. A forward reference inside a dynamic module's imports
        // makes Nest register the module a second time under another key.
        AuthModule,
        UserModule,
      ],
      controllers: [OAuthController],
      providers: [
        ...strategies,
        {
          provide: OAUTH_STRATEGIES,
          useFactory: (
            ...resolved: OAuthProviderStrategy[]
          ): OAuthProviderStrategy[] => resolved,
          inject: strategies,
        },
        OAuthRegistryService,
        OAuthStateService,
        OAuthRedirectService,
        OAuthService,
        ...OAUTH_PERSISTENCE_PROVIDERS,
        IsRegisteredProviderConstraint,
      ],
      exports: [
        OAUTH_STRATEGIES,
        OAuthRegistryService,
        OAuthStateService,
        OAuthService,
      ],
    };
  }
}
