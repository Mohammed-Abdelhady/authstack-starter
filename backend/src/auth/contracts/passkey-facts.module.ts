import { Module, type Provider, type Type } from '@nestjs/common';
import { EmptyPasskeyFacts } from './defaults/empty-passkey-facts';
import { PasskeyFacts } from './passkey-facts';
// feature:passkeys:start
import { LegacyPasskeyFactsModule } from '../passkeys/passkey-facts.module';
import { LegacyPasskeyFacts } from '../passkeys/services/legacy-passkey-facts';
// feature:passkeys:end

// The last candidate wins; pruning passkeys leaves the empty fallback.
const PASSKEY_FACTS_IMPLEMENTATIONS: [
  Type<PasskeyFacts>,
  ...Type<PasskeyFacts>[],
] = [
  EmptyPasskeyFacts,
  LegacyPasskeyFacts, // feature:passkeys
];

const PASSKEY_FACTS_PROVIDER: Provider = {
  provide: PasskeyFacts,
  useExisting:
    PASSKEY_FACTS_IMPLEMENTATIONS[PASSKEY_FACTS_IMPLEMENTATIONS.length - 1],
};

@Module({
  imports: [
    LegacyPasskeyFactsModule, // feature:passkeys
  ],
  providers: [EmptyPasskeyFacts, PASSKEY_FACTS_PROVIDER],
  exports: [PasskeyFacts],
})
export class PasskeyFactsModule {}
