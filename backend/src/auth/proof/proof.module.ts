import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { SessionModule } from '../../session/session.module';
import { UserModule } from '../../user/user.module';
import { AuthContractsModule } from '../contracts/auth-contracts.module';
import { LegacyPasskeyFactsModule } from '../passkeys/passkey-facts.module'; // feature:passkeys
import { WebAuthnAdapter } from '../passkeys/services/webauthn.adapter'; // feature:passkeys
import { FreshProofGate } from './fresh-proof-gate';
import { StaffFreshProofGate } from './staff-fresh-proof-gate';
import { BrowserSessionGuard } from './guards/browser-session.guard';
import { ProofController } from './proof.controller';
import { EmailProofService } from './services/email-proof.service';
import { PasskeyProofController } from './passkey-proof.controller'; // feature:passkeys
import { PasskeyProofService } from './services/passkey-proof.service'; // feature:passkeys
import {
  PROOF_PERSISTENCE_IMPORTS,
  PROOF_PERSISTENCE_PROVIDERS,
} from './persistence/proof-persistence';

@Module({
  imports: [
    CommonModule,
    SessionModule,
    AuthContractsModule,
    UserModule,
    LegacyPasskeyFactsModule, // feature:passkeys
    ...PROOF_PERSISTENCE_IMPORTS,
  ],
  controllers: [
    ProofController,
    PasskeyProofController, // feature:passkeys
  ],
  providers: [
    ...PROOF_PERSISTENCE_PROVIDERS,
    { provide: FreshProofGate, useClass: StaffFreshProofGate },
    BrowserSessionGuard,
    EmailProofService,
    WebAuthnAdapter, // feature:passkeys
    PasskeyProofService, // feature:passkeys
  ],
  exports: [FreshProofGate],
})
export class ProofModule {}
