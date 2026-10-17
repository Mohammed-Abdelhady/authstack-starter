import type { ConfigService } from '@nestjs/config';

/**
 * ConfigService.set also copies String(value) into process.env under the
 * dotted key, and get() reads that copy back once the value is removed.
 * This keeps the value in the service and puts process.env back as it was.
 */
export function setConfigValue(
  config: ConfigService,
  key: string,
  value: unknown,
): void {
  const previous = process.env[key];
  try {
    config.set(key, value);
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}
