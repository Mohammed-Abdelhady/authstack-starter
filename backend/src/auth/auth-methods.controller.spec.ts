import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthMethodsController } from './auth-methods.controller';
import { AuthFeaturesService } from './services/features/auth-features.service';
import { OAuthRegistryService } from './oauth/oauth-registry.service'; // feature:oauth-core

describe('AuthMethodsController', () => {
  const providers = [{ id: 'google', displayName: 'Google' }]; // feature:oauth-core
  /** Written by hand: a project that left password sign-in out never offers it. */
  const carried: string[] = [
    'password', // feature:email-password
  ];

  async function createController(config: {
    passwordEnabled: boolean;
    magicLinkEnabled: boolean;
    twoFactorEnabled: boolean;
    passkeysEnabled?: boolean;
  }): Promise<AuthMethodsController> {
    const values: Record<string, boolean> = {
      'auth.passwordEnabled': config.passwordEnabled,
      'magicLink.enabled': config.magicLinkEnabled,
      'twoFactor.enabled': config.twoFactorEnabled,
      'passkeys.enabled': config.passkeysEnabled ?? true,
    };

    const configService = {
      get: jest.fn((key: string, fallback?: boolean) =>
        key in values ? values[key] : fallback,
      ),
    };

    // feature:oauth-core:start
    const registry = {
      listEnabled: jest.fn().mockReturnValue(providers),
    };
    // feature:oauth-core:end

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthMethodsController],
      providers: [
        AuthFeaturesService,
        { provide: ConfigService, useValue: configService },
        { provide: OAuthRegistryService, useValue: registry }, // feature:oauth-core
      ],
    }).compile();

    return module.get<AuthMethodsController>(AuthMethodsController);
  }

  it('should report both credential methods and the configured providers', async () => {
    const controller = await createController({
      passwordEnabled: true,
      magicLinkEnabled: true,
      twoFactorEnabled: true,
    });

    expect(controller.getMethods()).toEqual({
      success: true,
      data: {
        methods: {
          password: carried.includes('password'),
          magicLink: true, // feature:magic-link
          twoFactor: true, // feature:totp
          passkeys: true, // feature:passkeys
          oauth: providers, // feature:oauth-core
        },
      },
      message: undefined,
    });
  });

  it('should leave out a method the deployment turned off', async () => {
    const controller = await createController({
      passwordEnabled: false,
      magicLinkEnabled: true,
      twoFactorEnabled: false,
      passkeysEnabled: false,
    });

    expect(controller.getMethods().data.methods).toMatchObject({
      password: false,
      magicLink: true, // feature:magic-link
      twoFactor: false, // feature:totp
      passkeys: false, // feature:passkeys
    });
  });
});
