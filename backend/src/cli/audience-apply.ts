import { NestFactory } from '@nestjs/core';
import { AudienceApplyService } from './audience-apply.service';
import { audienceApplyArguments } from './utils/audience-apply-arguments';

async function main(): Promise<void> {
  const options = audienceApplyArguments(process.argv.slice(2));
  const { AudienceApplyModule } = await import('./audience-apply.module');
  const context = await NestFactory.createApplicationContext(
    AudienceApplyModule,
    {
      logger: ['error', 'warn'],
    },
  );
  try {
    console.log(
      JSON.stringify(await context.get(AudienceApplyService).apply(options)),
    );
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    `Audience mapping failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
