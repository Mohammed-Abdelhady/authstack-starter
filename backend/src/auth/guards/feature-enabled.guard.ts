import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { AUTH_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import { AuthFeature } from '../enums/auth-feature.enum';
import { AuthFeaturesService } from '../services/features/auth-features.service';

/**
 * Closes the routes of a sign-in method the deployment turned off. Applied by
 * `@RequiresFeature()`; routes without that metadata pass through.
 */
@Injectable()
export class FeatureEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authFeaturesService: AuthFeaturesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<AuthFeature | undefined>(
      AUTH_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!feature) {
      return true;
    }

    await this.authFeaturesService.assertForRequest(
      feature,
      context.switchToHttp().getRequest<Request>(),
    );
    return true;
  }
}
