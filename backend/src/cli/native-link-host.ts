import { APP_CONFIGURATION } from '../config/app-configuration';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { BrowserApplications } from '../session/applications/browser-applications';
import { linkHostManifest } from '../session/native/association/link-host-paths';

@Module({
  imports: [APP_CONFIGURATION],
  providers: [
    {
      provide: BrowserApplications,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new BrowserApplications(config, () => Promise.resolve(false)),
    },
  ],
})
class NativeLinkHostConfigurationModule {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--proxy-manifest') {
    throw new Error(
      'Usage: node dist/cli/native-link-host.js --proxy-manifest',
    );
  }
  const context = await NestFactory.createApplicationContext(
    NativeLinkHostConfigurationModule,
    { logger: false, abortOnError: false },
  );
  try {
    const manifest = linkHostManifest(
      context.get(ConfigService),
      context.get(BrowserApplications),
    );
    process.stdout.write(`${JSON.stringify(manifest)}\n`);
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Link-host configuration failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
