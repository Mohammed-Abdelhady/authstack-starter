import { AuthenticatedUserSummary } from '../../interfaces/authenticated-user.interface';
import {
  AssertionVerification,
  AttestationVerification,
  AuthenticationOptionsInput,
  PasskeyCreationOptions,
  PasskeyRequestOptions,
  RegistrationOptionsInput,
  StoredCredential,
  WebAuthnAdapter,
} from '../services/webauthn.adapter';
import {
  PasskeyAccount,
  PasskeySignIn,
  PasskeySignInOutcome,
} from '../stores/passkey-accounts';

/**
 * Stands where the WebAuthn library stands. Signatures cannot be made here, so
 * a case says what the library would have answered and reads what it was shown.
 */
export class ScriptedAuthenticator extends WebAuthnAdapter {
  private issued = 0;
  /** What the next attestation check answers. Null is a refusal. */
  attestation: AttestationVerification | null = null;
  /** What the next assertion check answers. Null is a refusal. */
  assertion: AssertionVerification | null = null;
  readonly registrationOptions: RegistrationOptionsInput[] = [];
  readonly authenticationOptions: AuthenticationOptionsInput[] = [];
  /** The stored credential each assertion was checked against. */
  readonly checkedAgainst: StoredCredential[] = [];
  /** The challenge each ceremony was expected to have signed. */
  readonly expectedChallenges: string[] = [];

  createRegistrationOptions(
    input: RegistrationOptionsInput,
  ): Promise<PasskeyCreationOptions> {
    this.registrationOptions.push(input);
    return Promise.resolve({
      challenge: this.nextChallenge(),
      rp: { id: input.rpId, name: input.rpName },
      user: {
        id: input.userId,
        name: input.userName,
        displayName: input.userDisplayName,
      },
      pubKeyCredParams: [],
    });
  }

  createAuthenticationOptions(
    input: AuthenticationOptionsInput,
  ): Promise<PasskeyRequestOptions> {
    this.authenticationOptions.push(input);
    return Promise.resolve({ challenge: this.nextChallenge() });
  }

  verifyAttestation(
    _credential: unknown,
    expected: { challenge: string },
  ): Promise<AttestationVerification | null> {
    this.expectedChallenges.push(expected.challenge);
    return Promise.resolve(this.attestation);
  }

  verifyAssertion(
    _credential: unknown,
    stored: StoredCredential,
    expected: { challenge: string },
  ): Promise<AssertionVerification | null> {
    this.checkedAgainst.push(stored);
    this.expectedChallenges.push(expected.challenge);
    return Promise.resolve(this.assertion);
  }

  private nextChallenge(): string {
    this.issued += 1;
    return `contract-challenge-${this.issued}`;
  }
}

const SUMMARY = {
  email: 'signed-in@example.test',
  name: 'Signed In',
  role: 'user',
  authProvider: 'email',
  isVerified: true,
  permissions: [],
};

/**
 * Stands where the shared sign-in stands. Sessions are behind their own
 * stores and have their own contract, so these cases record which account was
 * handed over and by which of the two doors.
 */
export class RecordingSignIn extends PasskeySignIn {
  /** Accounts given a session with no second factor check. */
  readonly issued: string[] = [];
  /** Accounts sent through the sign-in every other route runs. */
  readonly completed: string[] = [];
  owesSecondFactor = false;

  issueSession(account: PasskeyAccount): Promise<AuthenticatedUserSummary> {
    this.issued.push(account.id);
    return Promise.resolve({ ...SUMMARY, id: account.id });
  }

  completeSignIn(account: PasskeyAccount): Promise<PasskeySignInOutcome> {
    this.completed.push(account.id);
    return Promise.resolve(
      this.owesSecondFactor
        ? { requiresTwoFactor: true }
        : { requiresTwoFactor: false, user: { ...SUMMARY, id: account.id } },
    );
  }
}
