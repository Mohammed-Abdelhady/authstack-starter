import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { SessionModule } from '../../session/session.module';
import { UserModule } from '../../user/user.module';
import { AuthModule } from '../auth.module';
import { AuthContractsModule } from '../contracts/auth-contracts.module';
import { LegacyPasskeyFactsModule } from '../passkeys/passkey-facts.module'; // feature:passkeys
import { WebAuthnAdapter } from '../passkeys/services/webauthn.adapter'; // feature:passkeys
import { ProofGateModule } from './proof-gate.module';
import { BrowserSessionGuard } from './guards/browser-session.guard';
import { ProofController } from './proof.controller';
import { EmailProofService } from './services/email-proof.service';
import { PasskeyProofController } from './passkey-proof.controller'; // feature:passkeys
import { NativePasskeyProofController } from './native-passkey-proof.controller'; // feature:passkeys
import { NativeProofSessionGuard } from './guards/native-proof-session.guard'; // feature:passkeys
import { PasskeyProofService } from './services/passkey-proof.service'; // feature:passkeys

@Module({
  imports: [
    CommonModule,
    AuthModule,
    SessionModule,
    AuthContractsModule,
    UserModule,
    LegacyPasskeyFactsModule, // feature:passkeys
    ProofGateModule,
  ],
  controllers: [
    ProofController,
    PasskeyProofController, // feature:passkeys
    NativePasskeyProofController, // feature:passkeys
  ],
  providers: [
    BrowserSessionGuard,
    NativeProofSessionGuard, // feature:passkeys
    EmailProofService,
    WebAuthnAdapter, // feature:passkeys
    PasskeyProofService, // feature:passkeys
  ],
  exports: [ProofGateModule],
})
export class ProofModule {}
