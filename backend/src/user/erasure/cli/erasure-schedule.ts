import { NestFactory } from '@nestjs/core';
import {
  ErasureScheduleCommand,
  erasureScheduleArguments,
} from './erasure-schedule.command';

async function main(): Promise<void> {
  const options = erasureScheduleArguments(process.argv.slice(2));
  const { ErasureScheduleModule } = await import('./erasure-schedule.module');
  const context = await NestFactory.createApplicationContext(
    ErasureScheduleModule,
    { logger: ['error', 'warn'] },
  );
  try {
    console.log(
      JSON.stringify(
        await context.get(ErasureScheduleCommand).schedule(options),
      ),
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Scheduling erasure failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
