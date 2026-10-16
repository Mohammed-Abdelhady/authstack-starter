import { NestFactory } from '@nestjs/core';
import { AdminRecoverService } from './admin-recover.service';
import { adminRecoverArguments } from './admin-command-arguments';
import { adminCommandFailure } from './admin-command-error';

async function main(): Promise<void> {
  const options = adminRecoverArguments(process.argv.slice(2));
  const { AdminRecoverModule } = await import('./admin-recover.module');
  const context = await NestFactory.createApplicationContext(
    AdminRecoverModule,
    { logger: false, abortOnError: false },
  );
  try {
    console.log(
      JSON.stringify(await context.get(AdminRecoverService).recover(options)),
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => adminCommandFailure('admin:recover', error));
