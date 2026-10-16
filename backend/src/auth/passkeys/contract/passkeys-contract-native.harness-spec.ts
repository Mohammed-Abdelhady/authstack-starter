import { ConfigService } from '@nestjs/config';
import { AuthEpochService } from '../../../common/services/auth-epoch.service';
import { CREDENTIAL_PURPOSE } from '../../../session/constants/credential-purpose';
import { PasskeyCredentialDto } from '../dto/passkey-credential.dto';
import {
  NativePasskeyRegistrationService,
  NativeRegisteringSession,
} from '../native/native-passkey-registration.service';
import { NativeRelyingParties } from '../native/native-relying-parties';
import { PasskeyConfigService } from '../services/passkey-config.service';
import { PasskeyRecorder } from '../services/passkey-recorder.service';
import { PasskeysContractHarness } from './passkeys-contract-database.harness-spec';
import {
  CREDENTIAL_ID,
  NOW,
  PasskeyServices,
  sha256,
} from './passkeys-contract.harness-spec';

/** Written out, so a changed rule cannot agree with itself. */
export const WEB_RP_ID = 'localhost';
export const APP_RP_ID = 'app.example.test';
export const APP_ORIGIN = 'android:apk-key-hash:Y29udHJhY3QtYXBwLWtleQ';
export const APP_CLIENT_ID = 'contract-native-app';
export const PLAIN_CLIENT_ID = 'contract-app-without-passkeys';
export const FIVE_MINUTES_MS = 300_000;

const APPLICATIONS = [
  {
    clientId: APP_CLIENT_ID,
    displayName: 'Contract app',
    redirectUris: [],
    allowedScopes: [],
    signIn: { passkeys: true, rpId: APP_RP_ID, origins: [APP_ORIGIN] },
  },
  {
    clientId: PLAIN_CLIENT_ID,
    displayName: 'Contract app without passkeys',
    redirectUris: [],
    allowedScopes: [],
    signIn: { password: true },
  },
];

/** A mobile session of the app, signed in `ageMs` before the frozen time. */
export function appSession(
  id: string,
  ageMs = 0,
  clientId: string = APP_CLIENT_ID,
): NativeRegisteringSession {
  const signedInAt = new Date(NOW.getTime() - ageMs);
  return {
    id,
    createdAt: signedInAt,
    authenticatedAt: signedInAt,
    credentialPurpose: CREDENTIAL_PURPOSE.NATIVE_ACCESS,
    clientId,
  };
}

/** The real native registration on this database, beside the browser one. */
export function nativeRegistration(
  harness: PasskeysContractHarness,
  services: PasskeyServices,
  recorder: PasskeyRecorder = services.recorder,
): NativePasskeyRegistrationService {
  const config = new ConfigService({
    passkeys: {
      rpId: WEB_RP_ID,
      rpName: 'Contract',
      origin: 'http://localhost:3000',
    },
    auth: { nativeApplications: APPLICATIONS },
  });
  return new NativePasskeyRegistrationService(
    harness.passkeys,
    harness.accounts,
    services.authenticator,
    new PasskeyConfigService(config),
    harness.challenges,
    new NativeRelyingParties(new AuthEpochService(config)),
    recorder,
    harness.clock,
  );
}

/** What an app sends back: client data naming the challenge it signed. */
export function appCredential(
  challenge: string,
  id: string = CREDENTIAL_ID,
): PasskeyCredentialDto {
  const clientData = {
    type: 'webauthn.create',
    challenge,
    origin: APP_ORIGIN,
  };
  return Object.assign(new PasskeyCredentialDto(), {
    id,
    rawId: id,
    response: {
      clientDataJSON: Buffer.from(JSON.stringify(clientData)).toString(
        'base64url',
      ),
      attestationObject: 'AA',
    },
    clientExtensionResults: {},
    type: 'public-key',
  });
}

/** The stored digest of a native challenge, worked out apart from the service. */
export function nativeChallengeHash(
  sessionId: string,
  userId: string,
  challenge: string,
): string {
  return sha256(
    ['native-passkey-register', sessionId, userId, APP_RP_ID, challenge].join(
      ':',
    ),
  );
}
