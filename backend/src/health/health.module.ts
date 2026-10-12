import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HEALTH_PERSISTENCE_PROVIDERS } from './persistence/health-persistence';

/**
 * Health check module
 * Provides health monitoring endpoints for the application
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService, ...HEALTH_PERSISTENCE_PROVIDERS],
  exports: [HealthService],
})
export class HealthModule {}
