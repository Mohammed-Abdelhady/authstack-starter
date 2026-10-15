import type { Type } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PasskeyFactsModule } from '../../src/auth/contracts/passkey-facts.module';
import { PasskeyFacts } from '../../src/auth/contracts/passkey-facts';
import { EmptyPasskeyFacts } from '../../src/auth/contracts/defaults/empty-passkey-facts';
import { LegacyPasskeyFacts } from '../../src/auth/passkeys/services/legacy-passkey-facts'; // feature:passkeys
import { STORAGE_CONNECTION_IMPORTS } from '../../src/common/persistence/common-persistence';
import { startE2eStorage, type E2eStorage } from '../utils/e2e-storage';
import {
  SESSION_AUTHORITY_BOOT_TIMEOUT_MS,
  SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS,
} from '../utils/hook-timeouts';

describe('PasskeyFactsModule binding', () => {
  let storage: E2eStorage;
  let module: TestingModule;

  beforeAll(async () => {
    storage = await startE2eStorage();
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [() => storage.environment],
        }),
        ...STORAGE_CONNECTION_IMPORTS,
        PasskeyFactsModule,
      ],
    });
    await storage.prepare(builder);
    module = await builder.compile();
  }, SESSION_AUTHORITY_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await module?.close();
    } finally {
      await storage?.stop();
    }
  }, SESSION_AUTHORITY_TEARDOWN_TIMEOUT_MS);

  it('resolves the passkey facts implementation carried by this build', () => {
    const IMPLEMENTATIONS: [Type<PasskeyFacts>, ...Type<PasskeyFacts>[]] = [
      EmptyPasskeyFacts,
      LegacyPasskeyFacts, // feature:passkeys
    ];
    expect(module.get(PasskeyFacts)).toBeInstanceOf(
      IMPLEMENTATIONS[IMPLEMENTATIONS.length - 1],
    );
  });
});
