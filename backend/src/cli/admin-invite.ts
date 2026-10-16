import { NestFactory } from '@nestjs/core';
import { AdminInviteService } from './admin-invite.service';
import { adminInviteArguments } from './admin-command-arguments';
import { adminCommandFailure } from './admin-command-error';

async function main(): Promise<void> {
  const options = adminInviteArguments(process.argv.slice(2));
  const { AdminInviteModule } = await import('./admin-invite.module');
  const context = await NestFactory.createApplicationContext(
    AdminInviteModule,
    { logger: false, abortOnError: false },
  );
  try {
    console.log(
      JSON.stringify(await context.get(AdminInviteService).invite(options)),
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => adminCommandFailure('admin:invite', error));
